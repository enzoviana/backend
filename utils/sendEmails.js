const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

/**
 * 📧 Envoie un e-mail basé sur un template HTML ou HTML direct
 * @param {Object} options - paramètres d'envoi
 * @param {string} options.to - destinataire de l'e-mail
 * @param {string} options.subject - sujet de l'e-mail
 * @param {string} options.template - nom du fichier template HTML (ex: 'RappelRdv.html')
 * @param {Object} options.variables - objet contenant les variables à injecter dans le template
 * @param {string} options.html - HTML direct (si fourni, ignore template et variables)
 */
// 📬 Configuration du transport SMTP (Une seule fois au démarrage)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT == 465, // true si port 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  // ⚡ Optimisation pour éviter rate limit Hostinger
  pool: true,
  maxConnections: 2,        // ⬇️ Réduit de 5 à 2 pour éviter surcharge
  maxMessages: 10,          // ⬇️ Réduit de 100 à 10 emails par connexion
  rateDelta: 2000,          // ⏱️ Attend 2 secondes entre chaque email
  rateLimit: 5,             // 📊 Max 5 emails toutes les 2 secondes
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  debug: true,
  logger: true
});

// 🕐 Fonction d'attente (sleep)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 📧 Envoie un e-mail basé sur un template HTML ou HTML direct avec retry automatique
 */
async function sendEmail({ to, subject, template, variables = {}, html, retryCount = 0 }) {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s

  try {
    let htmlContent;

    if (html) {
      htmlContent = html;
    } else if (template) {
      const templatePath = path.join(__dirname, `../templates/${template}`);
      if (!fs.existsSync(templatePath)) throw new Error(`Template introuvable: ${template}`);

      htmlContent = fs.readFileSync(templatePath, 'utf-8');

      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        htmlContent = htmlContent.replace(regex, value);
      }
    } else {
      throw new Error('Vous devez fournir soit "template" soit "html"');
    }

    // 📤 Envoi de l'e-mail (Réutilise le transporter existant)
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_SENDER_NAME || 'Dimotec Diagnostic'}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: htmlContent
    });

    console.log(`✅ E-mail envoyé à ${to} [ID: ${info.messageId}]`);
    return info;

  } catch (error) {
    // 🔴 Détection erreur Rate Limit Hostinger (451 4.7.1)
    const isRateLimit = error.message?.includes('451') ||
                        error.message?.includes('ratelimit') ||
                        error.message?.includes('Ratelimit') ||
                        error.responseCode === 451;

    if (isRateLimit && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.warn(`⚠️ Rate limit détecté pour ${to}. Retry ${retryCount + 1}/${MAX_RETRIES} dans ${delay/1000}s...`);

      await sleep(delay);

      // 🔄 Retry avec compteur incrémenté
      return sendEmail({ to, subject, template, variables, html, retryCount: retryCount + 1 });
    }

    // 🚨 Échec définitif après tous les retries ou autre erreur
    console.error(`❌ Erreur lors de l'envoi de l'e-mail à ${to}:`, error.message);

    // Créer une erreur plus explicite pour le rate limit
    if (isRateLimit) {
      const rateError = new Error(`Rate limit Hostinger atteint. Email non envoyé après ${MAX_RETRIES} tentatives.`);
      rateError.code = 'RATE_LIMIT_EXCEEDED';
      rateError.originalError = error;
      throw rateError;
    }

    throw error;
  }
}

module.exports = sendEmail;