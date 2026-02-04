require('dotenv').config();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const mongoose = require('mongoose');
const Devis = require('../models/Devis'); // adapte si besoin

const config = {
  imap: {
    user: process.env.BOUNCE_EMAIL_USER,
    password: process.env.BOUNCE_EMAIL_PASS,
    host: process.env.BOUNCE_EMAIL_HOST || 'imap.gmail.com',
    port: 993,
    tls: true,
    authTimeout: 10000
  }
};

/**
 * Extraction robuste de l'email client ayant échoué
 */
function extractFailedEmail(parsed) {
  const body = parsed.text || '';

  const patterns = [
    /Final-Recipient:\s*rfc822;\s*([^\s]+)/i,
    /Original-Recipient:\s*rfc822;\s*([^\s]+)/i,
    /<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>:\s*host/i, // format MailChannels/Postfix
    /The following address(?:es)? failed:\s*([^\s]+)/i,
    /Diagnostic-Code:.*\s([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1].toLowerCase().trim();
  }

  return null;
}

/**
 * Détermine si c'est un hard bounce (permanent)
 */
function isHardBounce(parsed) {
  const body = (parsed.text || '').toLowerCase();

  return (
    body.includes('5.1.1') ||
    body.includes('user does not exist') ||
    body.includes('no such user') ||
    body.includes('recipient address rejected')
  );
}

async function checkBounces() {
  try {
    console.log('📬 Vérification des bounces...');

    await mongoose.connect(process.env.MONGO_LIVE);

    const connection = await imaps.connect({ imap: config.imap });
    await connection.openBox('INBOX');

    const searchCriteria = ['UNSEEN']; // on filtre après
    const fetchOptions = { bodies: [''] };

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const item of messages) {
      const all = item.parts.find(part => part.which === '');
      const parsed = await simpleParser(all.body);

      const subject = parsed.subject?.toLowerCase() || '';
      const from = parsed.from?.text?.toLowerCase() || '';
      const body = parsed.text || '';

      // 🔎 Vérifier que c'est bien un bounce
      const isBounce =
        subject.includes('delivery') ||
        subject.includes('failed') ||
        from.includes('mailer-daemon') ||
        body.includes('Final-Recipient') ||
        body.includes('host ');

      if (!isBounce) continue;

      const failedEmail = extractFailedEmail(parsed);

      if (!failedEmail) {
        console.log('⚠️ Bounce reçu mais email non identifié');
        continue;
      }

      if (failedEmail === process.env.BOUNCE_EMAIL_USER) {
        console.log('⚠️ Bounce loop détecté, ignoré');
        continue;
      }

      const hard = isHardBounce(parsed);

      console.log(`${hard ? '💥 HARD' : '⚠️ SOFT'} BOUNCE détecté pour:`, failedEmail);

      await Devis.updateMany(
        { "client.email": failedEmail },
        {
          $set: {
            emailNonDelivre: true,
            statut: "Email_Errone",
            bounceType: hard ? "HARD" : "SOFT",
            bounceDate: new Date()
          }
        }
      );

      await connection.addFlags(item.attributes.uid, '\\Seen');
    }

    await connection.end();
    console.log('✅ Vérification bounces terminée');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erreur checkBounces:', err);
    process.exit(1);
  }
}

// Lancer directement
checkBounces();
