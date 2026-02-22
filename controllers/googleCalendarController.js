const { google } = require('googleapis');
const Admin = require('../models/Admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Configuration OAuth2
 */
const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'https://dimotec-e6595d1ca374.herokuapp.com/api/admin/google/auth/callback' 
  );
};

/**
 * Scopes Google Calendar requis
 */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
];

/**
 * 🔗 Générer l'URL d'authentification OAuth2
 */
exports.getAuthUrl = async (req, res) => {
  try {
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Admin non authentifié'
      });
    }

    // Vérifier l'accès à Google Calendar
    const admin = await Admin.findById(adminId);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin introuvable'
      });
    }

    if (!admin.aAccesGoogleCalendar()) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Vous devez acheter l\'option Google Calendar ou disposer du Pack Évolutions.'
      });
    }

    const oauth2Client = getOAuth2Client();

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: adminId.toString(), // Passer l'ID de l'admin dans le state
      prompt: 'consent' // Forcer le consentement pour obtenir refresh_token
    });

    return res.status(200).json({
      success: true,
      authUrl
    });
  } catch (err) {
    console.error('Erreur getAuthUrl:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération de l\'URL d\'authentification'
    });
  }
};

/**
 * ✅ Callback OAuth2 après autorisation
 */
exports.handleCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.redirect(`${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=no_code`);
    }

    const adminId = state;

    if (!adminId) {
      return res.redirect(`${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=no_state`);
    }

    const oauth2Client = getOAuth2Client();

    // Échanger le code contre des tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Récupérer l'email de l'utilisateur
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Sauvegarder dans la base de données
    const admin = await Admin.findById(adminId).select('+googleCalendar.accessToken +googleCalendar.refreshToken');

    if (!admin) {
      return res.redirect(`${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=admin_not_found`);
    }

    // Vérifier l'accès
    if (!admin.aAccesGoogleCalendar()) {
      return res.redirect(`${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=access_denied`);
    }

    await admin.connectGoogleCalendar({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date,
      email: userInfo.data.email
    });

    console.log(`✅ Google Calendar connecté pour ${admin.email}`);

    // Rediriger vers le frontend avec succès
    return res.redirect(`${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_success=true`);
  } catch (err) {
    console.error('Erreur handleCallback:', err);
    return res.redirect(`${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=callback_failed`);
  }
};

/**
 * 📊 Vérifier le statut de connexion
 */
exports.getStatus = async (req, res) => {
  try {
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Admin non authentifié'
      });
    }

    const admin = await Admin.findById(adminId).select('googleCalendar contratMaintenance optionsAchetees');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin introuvable'
      });
    }

    const hasAccess = admin.aAccesGoogleCalendar();
    const optionAchetee = admin.optionsAchetees?.googleCalendar?.actif || false;
    const packEvolution = admin.contratMaintenance?.actif && admin.contratMaintenance?.type === 'evolution';

    // Log pour debug
    console.log(`🔍 Google Calendar Status pour admin ${adminId}:`, {
      contratMaintenance: admin.contratMaintenance,
      hasAccess,
      optionAchetee,
      packEvolution
    });

    return res.status(200).json({
      success: true,
      isConnected: admin.googleCalendar?.isConnected || false,
      email: admin.googleCalendar?.email || null,
      connectedAt: admin.googleCalendar?.connectedAt || null,
      lastSync: admin.googleCalendar?.lastSync || null,
      hasAccess,
      optionAchetee,
      packEvolution,
      dateAchat: admin.optionsAchetees?.googleCalendar?.dateAchat || null,
      prixPaye: admin.optionsAchetees?.googleCalendar?.prixPaye || null,
      prixOption: parseInt(process.env.GOOGLE_CALENDAR_OPTION_PRICE || 75000, 10) / 100 // En euros
    });
  } catch (err) {
    console.error('Erreur getStatus:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification du statut'
    });
  }
};

/**
 * 🔌 Déconnecter Google Calendar
 */
exports.disconnect = async (req, res) => {
  try {
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Admin non authentifié'
      });
    }

    const admin = await Admin.findById(adminId);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin introuvable'
      });
    }

    await admin.disconnectGoogleCalendar();

    return res.status(200).json({
      success: true,
      message: 'Google Calendar déconnecté avec succès'
    });
  } catch (err) {
    console.error('Erreur disconnect:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la déconnexion'
    });
  }
};

/**
 * 📅 Créer un événement dans Google Calendar
 */
exports.createEvent = async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { title, description, location, startDateTime, endDateTime, attendees } = req.body;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Admin non authentifié'
      });
    }

    // Récupérer l'admin avec les tokens
    const admin = await Admin.findById(adminId).select('+googleCalendar.accessToken +googleCalendar.refreshToken');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin introuvable'
      });
    }

    // Vérifier l'accès à Google Calendar
    if (!admin.aAccesGoogleCalendar()) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Vous devez acheter l\'option Google Calendar ou disposer du Pack Évolutions.'
      });
    }

    if (!admin.googleCalendar?.isConnected) {
      return res.status(403).json({
        success: false,
        message: 'Google Calendar n\'est pas connecté. Veuillez vous connecter d\'abord.'
      });
    }

    // Configurer OAuth2 avec les tokens
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: admin.googleCalendar.accessToken,
      refresh_token: admin.googleCalendar.refreshToken
    });

    // Vérifier si le token est expiré et le rafraîchir si nécessaire
    if (admin.isGoogleTokenExpired()) {
      console.log('🔄 Token expiré, rafraîchissement...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      // Mettre à jour les tokens dans la base
      await admin.connectGoogleCalendar({
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || admin.googleCalendar.refreshToken,
        tokenExpiry: credentials.expiry_date,
        email: admin.googleCalendar.email
      });
    }

    // Créer l'événement
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = {
      summary: title,
      description,
      location,
      start: {
        dateTime: startDateTime,
        timeZone: 'Europe/Paris'
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Europe/Paris'
      },
      attendees: attendees ? attendees.map(email => ({ email })) : [],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 jour avant
          { method: 'popup', minutes: 60 } // 1 heure avant
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      sendUpdates: 'all' // Envoyer les invitations par email
    });

    // Mettre à jour lastSync
    admin.googleCalendar.lastSync = new Date();
    await admin.save();

    console.log(`✅ Événement créé dans Google Calendar: ${response.data.htmlLink}`);

    return res.status(200).json({
      success: true,
      message: 'Événement créé avec succès',
      eventId: response.data.id,
      eventLink: response.data.htmlLink
    });
  } catch (err) {
    console.error('Erreur createEvent:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Erreur lors de la création de l\'événement'
    });
  }
};

/**
 * 💳 Créer une session de paiement Stripe pour l'option Google Calendar
 */
exports.createGoogleCalendarCheckoutSession = async (req, res) => {
  try {
    const adminId = req.user?.id;

    if (!adminId) {
      return res.status(401).json({
        success: false,
        message: 'Admin non authentifié'
      });
    }

    const admin = await Admin.findById(adminId);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin introuvable'
      });
    }

    // Vérifier si l'admin a déjà l'option active
    if (admin.aAccesGoogleCalendar()) {
      return res.status(400).json({
        success: false,
        message: 'Vous avez déjà accès à Google Calendar'
      });
    }

    // Prix de l'option Google Calendar (750€)
    const PRIX_GOOGLE_CALENDAR = process.env.GOOGLE_CALENDAR_OPTION_PRICE || 75000; // en centimes

    // Créer la session Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: admin.email,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Option Google Calendar',
              description: 'Synchronisation automatique de vos ordres de mission avec Google Calendar',
            },
            unit_amount: parseInt(PRIX_GOOGLE_CALENDAR, 10),
          },
          quantity: 1,
        },
      ],
      metadata: {
        adminId: adminId.toString(),
        type: 'google_calendar_option_admin',
        prixPaye: PRIX_GOOGLE_CALENDAR.toString()
      },
      success_url: `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?google_payment=cancelled`,
    });

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (err) {
    console.error('Erreur createGoogleCalendarCheckoutSession:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de la session de paiement'
    });
  }
};

/**
 * ✅ Gérer le succès du paiement Google Calendar (appelé par le webhook Stripe)
 */
exports.handleGoogleCalendarPaymentSuccess = async (session) => {
  try {
    console.log('📅 Traitement achat option Google Calendar:', session.id);

    const { adminId, prixPaye } = session.metadata;

    if (!adminId) {
      console.error('adminId manquant dans les métadonnées');
      return;
    }

    const admin = await Admin.findById(adminId);

    if (!admin) {
      console.error('Admin introuvable:', adminId);
      return;
    }

    // Activer l'option Google Calendar (illimité)
    admin.optionsAchetees = admin.optionsAchetees || {};
    admin.optionsAchetees.googleCalendar = {
      actif: true,
      dateAchat: new Date(),
      dateExpiration: null, // null = illimité
      prixPaye: parseInt(prixPaye, 10) / 100 // Convertir centimes en euros
    };

    await admin.save();

    console.log(`✅ Option Google Calendar activée pour l'admin ${admin.email}`);
  } catch (err) {
    console.error('Erreur handleGoogleCalendarPaymentSuccess:', err);
    throw err;
  }
};

module.exports = exports;
