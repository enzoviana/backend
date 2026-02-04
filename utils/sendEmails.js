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
 * 📧 Envoie un e-mail basé sur un template HTML ou HTML direct (1 seule tentative)
 */
async function sendEmail({ to, subject, template, variables = {}, html }) {
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

    // 📤 Envoi de l'e-mail (1 seule tentative)
const info = await transporter.sendMail({
  from: `"${process.env.EMAIL_SENDER_NAME || 'Dimotec Diagnostic'}" <${process.env.SMTP_USER}>`,
  to,
  subject,
  html: htmlContent,
  envelope: {
    from: process.env.BOUNCEMAIL, // <-- Ici tu rediriges les bounces
    to
  }
});


    console.log(`✅ E-mail envoyé à ${to} [ID: ${info.messageId}]`);
    return info;

  } catch (error) {
    console.error(`❌ Erreur lors de l'envoi de l'e-mail à ${to}:`, error.message);
    throw error;
  }
}

module.exports = sendEmail;