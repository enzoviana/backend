require('dotenv').config();
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const mongoose = require('mongoose');
const Devis = require('../models/Devis'); // adapte si besoin
const sendEmail = require("./sendEmails"); // <-- Vérifie le bon chemin selon ton projet

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

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_LIVE);
    }

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

    const connection = await imaps.connect({ imap: config.imap });
    await connection.openBox('INBOX');

    const searchCriteria = ['UNSEEN'];
    const fetchOptions = { bodies: [''], markSeen: false }; // On marque Seen manuellement après traitement

    const messages = await connection.search(searchCriteria, fetchOptions);

    for (const item of messages) {
      const all = item.parts.find(part => part.which === '');
      const parsed = await simpleParser(all.body);

      const subject = parsed.subject?.toLowerCase() || '';
      const from = parsed.from?.text?.toLowerCase() || '';
      const body = (parsed.text || '') + (parsed.html || '');

      // 🔎 Détection robuste du bounce
      const isBounce =
        subject.includes('delivery') ||
        subject.includes('failed') ||
        subject.includes('undelivered') ||
        from.includes('mailer-daemon') ||
        from.includes('postmaster') ||
        body.includes('Final-Recipient') ||
        body.includes('5.1.1') ||
        body.includes('does not exist');

      if (!isBounce) continue;

      const failedEmail = extractFailedEmail(parsed);

      if (!failedEmail) {
        console.log('⚠️ Bounce reçu mais email non identifié');
        continue;
      }

      // Éviter de traiter les bounces de nos propres emails techniques
      if (failedEmail === process.env.SMTP_USER) continue;

      const hard = isHardBounce(parsed);
      console.log(`${hard ? '💥 HARD' : '⚠️ SOFT'} BOUNCE détecté pour:`, failedEmail);

      // 1️⃣ Trouver les devis concernés (on utilise populate pour avoir les infos de l'agence)
      const devisConcernes = await Devis.find({ "client.email": failedEmail })
                                        .populate('shareAgency agenceId');

      if (devisConcernes.length > 0) {
        for (const devis of devisConcernes) {
          // 2️⃣ Mise à jour du statut du devis
          devis.emailNonDelivre = true;
          devis.emailClientErrone = failedEmail;
          devis.statut = "Email_Errone";
          devis.bounceType = hard ? "HARD" : "SOFT";
          devis.bounceDate = new Date();
          await devis.save();

          // 3️⃣ Notification à l'agence créatrice
          const agenceRef = devis.shareAgency || devis.agenceId;
          
          if (agenceRef && agenceRef.email) {
            console.log(`📧 Notification d'erreur envoyée à l'agence : ${agenceRef.email}`);
            
            await sendEmail({
              to: agenceRef.email,
              subject: `⚠️ Email erroné : Devis ${devis.numero}`,
              template: 'EmailErrone.html',
              variables: {
                nomAgence: agenceRef.nom || 'Partenaire',
                numeroDevis: devis.numero,
                nomClient: `${devis.client.prenom} ${devis.client.nom}`,
                emailErrone: failedEmail,
                link: `${process.env.FRONTEND_URL}/dashboard/devis`
              }
            });
          }
        }
        console.log(`✅ ${devisConcernes.length} devis mis à jour.`);
      }

      // Marquer le mail comme lu pour ne pas le retraiter au prochain cron
      await connection.addFlags(item.attributes.uid, '\\Seen');
    }

    await connection.end();
    console.log('✅ Vérification bounces terminée');
    
    // Si appelé en script autonome
    if (require.main === module) process.exit(0);

  } catch (err) {
    console.error('❌ Erreur checkBounces:', err);
    if (require.main === module) process.exit(1);
  }
}


// Lancer directement
checkBounces();
