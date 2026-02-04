const fs = require('fs');
const path = require('path');
const SibApiV3Sdk = require('sib-api-v3-sdk');

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

// Configuration Brevo API (une seule fois)
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// 🕐 Fonction d'attente (sleep)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 📧 Envoie un e-mail via Brevo avec retry automatique
 */
async function sendEmailBrevo({ to, subject, template, variables = {}, html, retryCount = 0 }) {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [2000, 5000, 10000]; // 2s, 5s, 10s

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

    // 📤 Préparation de l'email pour Brevo
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    sendSmtpEmail.sender = {
      name: process.env.EMAIL_SENDER_NAME || 'Dimotec Diagnostic',
      email: process.env.SMTP_USER || 'support@votre-devis-diagnostics.fr'
    };
    sendSmtpEmail.to = [{ email: to }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;

    // 📨 Envoi via Brevo API
    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log(`✅ [BREVO] E-mail envoyé à ${to} [Message ID: ${data.messageId}]`);
    return data;

  } catch (error) {
    // 🔴 Détection erreur rate limit ou temporaire
    const isRetryable = error.status === 429 || // Too Many Requests
                        error.status === 503 || // Service Unavailable
                        error.status === 500;   // Internal Server Error

    if (isRetryable && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.warn(`⚠️ [BREVO] Erreur temporaire ${error.status} pour ${to}. Retry ${retryCount + 1}/${MAX_RETRIES} dans ${delay/1000}s...`);

      await sleep(delay);

      // 🔄 Retry avec compteur incrémenté
      return sendEmailBrevo({ to, subject, template, variables, html, retryCount: retryCount + 1 });
    }

    // 🚨 Échec définitif
    console.error(`❌ [BREVO] Erreur lors de l'envoi de l'e-mail à ${to}:`, error.message);

    if (error.status === 429) {
      const rateError = new Error(`Limite Brevo atteinte. Email non envoyé après ${MAX_RETRIES} tentatives.`);
      rateError.code = 'RATE_LIMIT_EXCEEDED';
      rateError.originalError = error;
      throw rateError;
    }

    throw error;
  }
}

module.exports = sendEmailBrevo;
