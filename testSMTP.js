require('dotenv').config();
const nodemailer = require('nodemailer');

/**
 * 🧪 Script de test de connexion SMTP
 * Lance ce script pour vérifier si l'envoi d'email fonctionne
 */

console.log('🔧 Configuration SMTP chargée :');
console.log('  - Host:', process.env.SMTP_HOST);
console.log('  - Port:', process.env.SMTP_PORT);
console.log('  - User:', process.env.SMTP_USER);
console.log('  - Pass:', process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-3) : 'NON DÉFINI');
console.log('  - Bounce:', process.env.BOUNCEMAIL);
console.log('');

// Configuration du transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT == 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  debug: true,
  logger: true
});

async function testSMTP() {
  console.log('📡 Test 1: Vérification de la connexion SMTP...\n');

  try {
    // Test de la connexion
    await transporter.verify();
    console.log('✅ Connexion SMTP réussie !\n');
  } catch (error) {
    console.error('❌ Échec de connexion SMTP:');
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);
    console.error('   Command:', error.command);
    console.error('\n⚠️  Vérifiez vos identifiants SMTP dans le fichier .env\n');
    process.exit(1);
  }

  console.log('📧 Test 2: Envoi d\'un email de test...\n');

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_SENDER_NAME}" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER, // Envoyer à soi-même
      subject: '🧪 Test SMTP - ' + new Date().toLocaleString('fr-FR'),
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #4CAF50;">✅ Test SMTP réussi !</h2>
          <p>Ce mail confirme que la configuration SMTP fonctionne correctement.</p>
          <hr>
          <p style="color: #666; font-size: 12px;">
            Envoyé le ${new Date().toLocaleString('fr-FR')}<br>
            Depuis: ${process.env.SMTP_HOST}<br>
            Via: ${process.env.SMTP_USER}
          </p>
        </div>
      `
      // Note: Le paramètre envelope supprimé car Hostinger rejette les envois
      // avec une adresse d'expédition différente du compte SMTP
    });

    console.log('✅ Email envoyé avec succès !');
    console.log('   Message ID:', info.messageId);
    console.log('   Accepté par:', info.accepted);
    console.log('   Rejeté:', info.rejected.length > 0 ? info.rejected : 'Aucun');
    console.log('\n✨ Configuration SMTP valide ! Les devis devraient s\'envoyer correctement.\n');

  } catch (error) {
    console.error('❌ Échec d\'envoi d\'email:');
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);

    if (error.responseCode) {
      console.error('   Code de réponse SMTP:', error.responseCode);
      console.error('   Réponse:', error.response);
    }

    console.error('\n💡 Suggestions:');
    console.error('   - Vérifiez que le compte email existe sur Hostinger');
    console.error('   - Vérifiez le mot de passe (caractères spéciaux peuvent causer des problèmes)');
    console.error('   - Vérifiez que l\'email n\'a pas de limite d\'envoi atteinte');
    console.error('   - Testez avec Brevo API comme alternative (clé déjà configurée)\n');

    process.exit(1);
  }
}

testSMTP();
