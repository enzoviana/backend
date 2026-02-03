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
async function sendEmail({ to, subject, template, variables = {}, html }) {
  try {
    let htmlContent;

    // Si HTML direct est fourni, l'utiliser directement
    if (html) {
      htmlContent = html;
    } else if (template) {
      // Sinon, lire le template et remplacer les variables
      const templatePath = path.join(__dirname, `../templates/${template}`);
      htmlContent = fs.readFileSync(templatePath, 'utf-8');

      // 🔁 Remplacement des variables dans le template {{variable}}
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        htmlContent = htmlContent.replace(regex, value);
      }
    } else {
      throw new Error('Vous devez fournir soit "template" soit "html"');
    }

    // 📬 Configuration du transport SMTP
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true pour le port 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
    });

    // 📤 Envoi de l'e-mail
    await transporter.sendMail({
      from: `"${process.env.EMAIL_SENDER_NAME || 'Dimotec Diagnostic'}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: htmlContent
    });

    console.log(`✅ E-mail envoyé à ${to}${template ? ` avec le template "${template}"` : ' (HTML direct)'}`);
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi de l'e-mail :", error);
    throw error;
  }
}

module.exports = sendEmail;
