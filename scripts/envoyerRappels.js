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
        // Utiliser SMTP_USER car les bounces arrivent sur l'adresse d'envoi
        // et non sur BOUNCEMAIL (car Hostinger ne permet pas l'envelope spoofing)
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
    const fetchOptions = { bodies: ['HEADER'], markSeen: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const msg of messages) {
      const headers = msg.parts[0].body;
      const subject = headers.subject?.[0] || '';
      const to = headers.to?.[0];

      if (!to) continue;

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
