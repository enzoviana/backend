const imap = require('imap-simple');
const Devis = require('../models/Devis');

async function checkBounces() {
  try {
    const config = {
      imap: {
        user: process.env.BOUNCEMAIL,
        password: process.env.BOUNCEMDP,
        host: process.env.IMAP_HOST || 'imap.hostinger.com',
        port: 993,
        tls: true,
        authTimeout: 3000
      }
    };

    const connection = await imap.connect(config);
    await connection.openBox('INBOX');

    const searchCriteria = ['UNSEEN'];
    const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT)'], markSeen: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const msg of messages) {
      const to = msg.parts[0].body.to[0];
      console.log('❌ Email erroné détecté pour :', to);

      // Recherche du devis par email client ou déjà détecté
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
        console.log(`✅ Devis ${devis.numero} mis à jour en BDD pour email erroné`);
      } else {
        console.log('⚠️ Aucun devis trouvé pour cet email :', to);
      }
    }

    await connection.end();
  } catch (err) {
    console.error('❌ Erreur checkBounces:', err.message);
  }
}

module.exports = checkBounces;
