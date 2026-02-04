require('dotenv').config();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

const config = {
  imap: {
    user: process.env.BOUNCE_EMAIL_USER, // ex: bounce@domaine.com
    password: process.env.BOUNCE_EMAIL_PASS,
    host: process.env.BOUNCE_EMAIL_HOST || 'imap.gmail.com',
    port: 993,
    tls: true,
    authTimeout: 10000
  }
};

async function checkBounces() {
  try {
    const connection = await imaps.connect({ imap: config.imap });
    await connection.openBox('INBOX');

    const searchCriteria = ['UNSEEN', ['FROM', 'mailer-daemon']];
    const fetchOptions = { bodies: [''] };

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const item of messages) {
      const all = item.parts.find(part => part.which === '');
      const parsed = await simpleParser(all.body);

      console.log('Sujet:', parsed.subject);
      console.log('De:', parsed.from.text);
      console.log('À:', parsed.to.text);

      const bounceEmailMatch = parsed.text.match(/<(.+?)>/);
      if (bounceEmailMatch) {
        console.log('Adresse qui a rebondi:', bounceEmailMatch[1]);
        // Ici tu peux mettre à jour ta DB pour marquer l'email comme invalide
      }

      await connection.addFlags(item.attributes.uid, '\\Seen');
    }

    await connection.end();
  } catch (err) {
    console.error('Erreur IMAP:', err);
  }
}

// Lancer toutes les 5 minutes
setInterval(checkBounces, 5 * 60 * 1000);

// Optionnel : lancer immédiatement au démarrage
checkBounces();
