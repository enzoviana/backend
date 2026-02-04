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
  // ⚡ Optimisation Heroku : Garder la connexion ouverte
  pool: true, 
  maxConnections: 5,
  maxMessages: 100
});

/**
 * 📧 Envoie un e-mail basé sur un template HTML ou HTML direct
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
    console.error("❌ Erreur lors de l'envoi de l'e-mail :", error);
    throw error; // Important pour que le catch de ton contrôleur s'active !
  }
}

module.exports = sendEmail;