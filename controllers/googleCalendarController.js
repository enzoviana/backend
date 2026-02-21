const { google } = require('googleapis');
const Agency = require('../models/Agency');

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
    const agencyId = req.agence?._id;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: 'Agence non authentifiée'
      });
    }

    const oauth2Client = getOAuth2Client();

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: agencyId.toString(), // Passer l'ID de l'agence dans le state
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
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=no_code`);
    }

    const agencyId = state;

    if (!agencyId) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=no_state`);
    }

    const oauth2Client = getOAuth2Client();

    // Échanger le code contre des tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Récupérer l'email de l'utilisateur
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Sauvegarder dans la base de données
    const agency = await Agency.findById(agencyId).select('+googleCalendar.accessToken +googleCalendar.refreshToken');

    if (!agency) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=agency_not_found`);
    }

    await agency.connectGoogleCalendar({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: tokens.expiry_date,
      email: userInfo.data.email
    });

    console.log(`✅ Google Calendar connecté pour ${agency.nom_commercial}`);

    // Rediriger vers le frontend avec succès
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}/settings?google_success=true`);
  } catch (err) {
    console.error('Erreur handleCallback:', err);
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:8080'}/settings?google_error=callback_failed`);
  }
};

/**
 * 📊 Vérifier le statut de connexion
 */
exports.getStatus = async (req, res) => {
  try {
    const agencyId = req.agence?._id;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: 'Agence non authentifiée'
      });
    }

    const agency = await Agency.findById(agencyId).select('googleCalendar');

    if (!agency) {
      return res.status(404).json({
        success: false,
        message: 'Agence introuvable'
      });
    }

    return res.status(200).json({
      success: true,
      isConnected: agency.googleCalendar?.isConnected || false,
      email: agency.googleCalendar?.email || null,
      connectedAt: agency.googleCalendar?.connectedAt || null,
      lastSync: agency.googleCalendar?.lastSync || null
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
    const agencyId = req.agence?._id;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: 'Agence non authentifiée'
      });
    }

    const agency = await Agency.findById(agencyId);

    if (!agency) {
      return res.status(404).json({
        success: false,
        message: 'Agence introuvable'
      });
    }

    await agency.disconnectGoogleCalendar();

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
    const agencyId = req.agence?._id;
    const { title, description, location, startDateTime, endDateTime, attendees } = req.body;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: 'Agence non authentifiée'
      });
    }

    // Récupérer l'agence avec les tokens
    const agency = await Agency.findById(agencyId).select('+googleCalendar.accessToken +googleCalendar.refreshToken');

    if (!agency) {
      return res.status(404).json({
        success: false,
        message: 'Agence introuvable'
      });
    }

    if (!agency.googleCalendar?.isConnected) {
      return res.status(403).json({
        success: false,
        message: 'Google Calendar n\'est pas connecté. Veuillez vous connecter d\'abord.'
      });
    }

    // Configurer OAuth2 avec les tokens
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: agency.googleCalendar.accessToken,
      refresh_token: agency.googleCalendar.refreshToken
    });

    // Vérifier si le token est expiré et le rafraîchir si nécessaire
    if (agency.isGoogleTokenExpired()) {
      console.log('🔄 Token expiré, rafraîchissement...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      // Mettre à jour les tokens dans la base
      await agency.connectGoogleCalendar({
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || agency.googleCalendar.refreshToken,
        tokenExpiry: credentials.expiry_date,
        email: agency.googleCalendar.email
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
    agency.googleCalendar.lastSync = new Date();
    await agency.save();

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

module.exports = exports;
