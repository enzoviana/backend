require('dotenv').config();
const mongoose = require('mongoose');
const imap = require('imap-simple');
const Devis = require('../models/Devis');
const Agence = require('../models/Agency'); 
const sendEmail = require('../utils/sendEmails'); 
const { envoyerRappelsAutomatiques } = require('../controllers/devisController');

async function checkBounces() {
  try {
    console.log('📬 Vérification des bounces...');

    const config = {
      imap: {
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASS,
        host: process.env.IMAP_HOST || 'imap.hostinger.com',
        port: 993,
        tls: true,
        authTimeout: 3000
      }
    };

    const connection = await imap.connect(config);
    await connection.openBox('INBOX');

    const searchCriteria = ['UNSEEN'];
    const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT)', 'TEXT'], markSeen: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const msg of messages) {
      const header = msg.parts.find(p => p.which === 'HEADER.FIELDS (FROM TO SUBJECT)')?.body || {};
      const bodyPart = msg.parts.find(p => p.which === 'TEXT');
      const body = bodyPart?.body?.toLowerCase() || '';
      const subject = (header.subject?.[0] || '').toLowerCase();

      // Critères de détection d'un échec de distribution
      const isBounce =
        subject.includes('undelivered') ||
        subject.includes('delivery failure') ||
        subject.includes('returned mail') ||
        body.includes('550') ||
        body.includes('user unknown') ||
        body.includes('does not exist') ||
        body.includes('5.1.1');

      if (!isBounce) continue;

      const emailRegex = /<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/gi;
      let match;
      const emailsInBody = new Set();

      while ((match = emailRegex.exec(body)) !== null) {
        const email = match[1].toLowerCase();
        if (email !== process.env.SMTP_USER.toLowerCase()) {
          emailsInBody.add(email);
        }
      }

      for (const to of emailsInBody) {
        console.log('❌ Bounce détecté pour :', to);

        // Recherche du devis + population de l'agence (via shareAgency ou agenceId)
        const devis = await Devis.findOne({
          $or: [{ "client.email": to }, { emailClientErrone: to }]
        }).populate('shareAgency agenceId');

        if (devis) {
          devis.emailNonDelivre = true;
          devis.emailClientErrone = to;
          devis.statut = "Email_Errone";
          devis.bounceDate = new Date();
          await devis.save();
          console.log(`✅ Devis ${devis.numero} marqué comme erroné.`);

          // On détermine l'agence à prévenir
          const agence = devis.shareAgency || devis.agenceId;

          // On récupère l'email de l'admin de l'agence
          const emailDestinataire = agence?.admin?.email;

          if (emailDestinataire) {
            console.log(`📧 Notification envoyée à l'agence : ${emailDestinataire}`);
            
            try {
              await sendEmail({
                to: emailDestinataire,
                subject: `⚠️ Email erroné : Devis ${devis.numero}`,
                template: 'EmailErrone.html',
                variables: {
                  nomAgence: agence.nom_commercial || 'Partenaire',
                  numeroDevis: devis.numero,
                  nomClient: `${devis.client.prenom} ${devis.client.nom}`,
                  emailErrone: to,
                  link: "https://client-dimotec.datafuse.fr/billing"
                }
              });
            } catch (mailErr) {
              console.error(`❌ Erreur envoi mail notification: ${mailErr.message}`);
            }
          }
        }
      }
    }

    await connection.end();
    console.log('✅ Fin vérification bounces');
  } catch (err) {
    console.error('❌ Erreur checkBounces:', err.message);
  }
}

async function runCron() {
  try {
    console.log('⏳ Connexion MongoDB...');
    await mongoose.connect(process.env.MONGO_LIVE);

    await checkBounces();

    console.log('⏰ Rappels automatiques...');
    await envoyerRappelsAutomatiques();

    console.log('✅ CRON terminé');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur CRON:', err);
    process.exit(1);
  }
}

runCron();