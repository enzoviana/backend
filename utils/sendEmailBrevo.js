const fs = require('fs');
const path = require('path');

/**
 * 📧 Envoie un e-mail via l'API Brevo (anciennement Sendinblue)
 * @param {Object} options - paramètres d'envoi
 * @param {string} options.to - destinataire de l'e-mail
 * @param {string} options.subject - sujet de l'e-mail
 * @param {string} options.template - nom du fichier template HTML (ex: 'RappelRdv.html')
 * @param {Object} options.variables - objet contenant les variables à injecter dans le template
 * @param {string} options.html - HTML direct (si fourni, ignore template et variables)
 *
 * Avantages Brevo:
 * - 300 emails/jour GRATUITS
 * - Meilleure délivrabilité
 * - Tracking des ouvertures/clics
 * - Pas de rate limit 451
 */

/**
 * 📧 Envoie un e-mail via Brevo (1 seule tentative)
 */
async function sendEmailBrevo({ to, subject, template, variables = {}, html }) {
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

    // 📤 Appel API Brevo
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: process.env.EMAIL_SENDER_NAME || 'Dimotec Diagnostic',
          email: process.env.SMTP_USER || 'support@votre-devis-diagnostics.fr'
        },
        to: [{ email: to }],
        subject: subject,
        htmlContent: htmlContent
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Brevo API error: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    console.log(`✅ [BREVO] E-mail envoyé à ${to} [Message ID: ${data.messageId}]`);
    return data;

  } catch (error) {
    console.error(`❌ [BREVO] Erreur lors de l'envoi de l'e-mail à ${to}:`, error.message);
    throw error;
  }
}

module.exports = sendEmailBrevo;
