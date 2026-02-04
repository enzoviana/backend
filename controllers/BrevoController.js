exports.handleBrevoWebhook = async (req, res) => {
  const event = req.body;

  // Si le mail a échoué définitivement
  if (event.event === 'hard_bounce' || event.event === 'invalid_email') {
    const emailEmailErrone = event.email;
    console.log(`⚠️ Alerte : L'email ${emailEmailErrone} est mort.`);
    
    // Ici, tu peux mettre à jour ton Devis en BDD
    // await Devis.updateMany({'client.email': emailEmailErrone}, { statut: 'Erreur Email' });
  }

  res.status(200).send('OK'); // Toujours répondre 200 à Brevo
};