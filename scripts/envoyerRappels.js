require('dotenv').config();
const mongoose = require('mongoose');
const imap = require('imap-simple');
const Devis = require('../models/Devis');
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

    // On prend tous les mails non lus
    const searchCriteria = ['UNSEEN'];
    const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT)', 'TEXT'], markSeen: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const msg of messages) {
      const header = msg.parts.find(p => p.which === 'HEADER.FIELDS (FROM TO SUBJECT)')?.body || {};
      const bodyPart = msg.parts.find(p => p.which === 'TEXT');
      const body = bodyPart?.body?.toLowerCase() || '';
      const subject = (header.subject?.[0] || '').toLowerCase();

      // On ignore si ce n'est pas un bounce classique
      const isBounce =
        subject.includes('undelivered') ||
        subject.includes('delivery failure') ||
        subject.includes('returned mail') ||
        body.includes('550') ||
        body.includes('user unknown') ||
        body.includes('does not exist') ||
        body.includes('5.1.1');

      if (!isBounce) continue;

      // Extraction de tous les emails dans le corps
      const emailRegex = /<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/gi;
      let match;
      const emailsInBody = new Set();

      while ((match = emailRegex.exec(body)) !== null) {
        const email = match[1].toLowerCase();
        // On ignore l'email d'envoi
        if (email !== process.env.SMTP_USER.toLowerCase()) {
          emailsInBody.add(email);
        }
      }

      for (const to of emailsInBody) {
        console.log('❌ Bounce détecté pour :', to);

        const devis = await Devis.findOne({
          $or: [
            { emailClientErrone: to },
            { "client.email": to }
          ]
        });

        if (devis) {
          devis.emailNonDelivre = true;
          devis.emailClientErrone = to;
          devis.statut = "Email_Errone";
          devis.bounceDate = new Date();
          await devis.save();
          console.log(`✅ Devis ${devis.numero} mis à jour`);
        } else {
          console.log('⚠️ Aucun devis trouvé pour', to);
        }
      }
    }

    await connection.end();
    console.log('✅ Vérification bounces terminée');
  } catch (err) {
    console.error('❌ Erreur checkBounces:', err.message);
  }
}

async function runCron() {
  try {
    console.log('⏳ Connexion MongoDB...');
    await mongoose.connect(process.env.MONGO_LIVE);

    // 1️⃣ BOUNCES
    await checkBounces();

    // 2️⃣ RAPPELS AUTO
    console.log('⏰ Envoi des rappels automatiques...');
    await envoyerRappelsAutomatiques();

    console.log('✅ CRON terminé avec succès');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erreur CRON:', err);
    process.exit(1);
  }
}

runCron();
