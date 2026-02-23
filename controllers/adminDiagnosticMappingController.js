const DiagnosticCertificationMapping = require('../models/DiagnosticCertificationMapping');
const Diagnostic = require('../models/Diagnostic');
const DomaineActivite = require('../models/DomaineActivite');

/**
 * Récupérer tous les mappings
 */
exports.getMappings = async (req, res) => {
  try {
    const mappings = await DiagnosticCertificationMapping.find()
      .populate('diagnostic', 'nom code')
      .populate('domainesCertification.domaine', 'nom code');

    res.json({ mappings });
  } catch (error) {
    console.error('Erreur getMappings:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Récupérer un mapping par ID de diagnostic
 */
exports.getMappingByDiagnostic = async (req, res) => {
  try {
    const { diagnosticId } = req.params;

    const mapping = await DiagnosticCertificationMapping.findOne({ diagnostic: diagnosticId })
      .populate('diagnostic', 'nom code')
      .populate('domainesCertification.domaine', 'nom code');

    if (!mapping) {
      return res.status(404).json({ message: 'Aucun mapping trouvé pour ce diagnostic' });
    }

    res.json({ mapping });
  } catch (error) {
    console.error('Erreur getMappingByDiagnostic:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Créer ou mettre à jour un mapping
 */
exports.createOrUpdateMapping = async (req, res) => {
  try {
    const { diagnosticId, domainesCertification } = req.body;

    if (!diagnosticId || !domainesCertification) {
      return res.status(400).json({ message: 'Données manquantes (diagnosticId et domainesCertification requis)' });
    }

    // Vérifier que le diagnostic existe
    const diagnostic = await Diagnostic.findById(diagnosticId);
    if (!diagnostic) {
      return res.status(404).json({ message: 'Diagnostic non trouvé' });
    }

    // Vérifier que tous les domaines existent
    for (const dc of domainesCertification) {
      const domaine = await DomaineActivite.findById(dc.domaine);
      if (!domaine) {
        return res.status(404).json({ message: `Domaine ${dc.domaine} non trouvé` });
      }
    }

    let mapping = await DiagnosticCertificationMapping.findOne({ diagnostic: diagnosticId });

    if (mapping) {
      // Mise à jour
      mapping.domainesCertification = domainesCertification;
      await mapping.save();
    } else {
      // Création
      mapping = new DiagnosticCertificationMapping({
        diagnostic: diagnosticId,
        domainesCertification
      });
      await mapping.save();
    }

    await mapping.populate('diagnostic domainesCertification.domaine');

    res.json({
      message: 'Mapping enregistré avec succès',
      mapping
    });
  } catch (error) {
    console.error('Erreur createOrUpdateMapping:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Supprimer un mapping
 */
exports.deleteMapping = async (req, res) => {
  try {
    const { mappingId } = req.params;

    const mapping = await DiagnosticCertificationMapping.findByIdAndDelete(mappingId);

    if (!mapping) {
      return res.status(404).json({ message: 'Mapping non trouvé' });
    }

    res.json({ message: 'Mapping supprimé avec succès' });
  } catch (error) {
    console.error('Erreur deleteMapping:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Initialiser les mappings par défaut basés sur les codes
 */
exports.initialiserMappingsParDefaut = async (req, res) => {
  try {
    console.log('🔄 Initialisation des mappings par défaut...');

    // Récupérer tous les diagnostics et domaines
    const diagnostics = await Diagnostic.find();
    const domaines = await DomaineActivite.find();

    // Mapping par défaut basé sur le code du diagnostic
    const mappingsParDefaut = {
      'DPE': ['DPE'],
      'AMIANTE': ['AMIANTE'],
      'PLOMB': ['PLOMB'],
      'TERMITES': ['TERMITES'],
      'GAZ': ['GAZ'],
      'ELECTRICITE': ['ELECTRICITE'],
      'ERP': ['ERP'],
      'MESURAGE_LOI_CARREZ': ['CARREZ', 'SURFACE'],
      'MESURAGE_LOI_BOUTIN': ['BOUTIN', 'SURFACE'],
      'ASSAINISSEMENT': ['ASSAINISSEMENT'],
      'MERULES': ['MERULES']
    };

    let countCreated = 0;
    let countSkipped = 0;

    for (const diagnostic of diagnostics) {
      // Vérifier si mapping existe déjà
      const existant = await DiagnosticCertificationMapping.findOne({ diagnostic: diagnostic._id });
      if (existant) {
        countSkipped++;
        continue;
      }

      // Chercher les codes de domaines correspondants
      const codesDomaines = mappingsParDefaut[diagnostic.code] || [];
      const domainesCertification = [];

      for (const codeDomaine of codesDomaines) {
        const domaine = domaines.find(d => d.code === codeDomaine);
        if (domaine) {
          domainesCertification.push({
            domaine: domaine._id,
            obligatoire: true,
            mentionSpecialeRequise: null
          });
        }
      }

      // Créer le mapping seulement si on a trouvé des domaines
      if (domainesCertification.length > 0) {
        await DiagnosticCertificationMapping.create({
          diagnostic: diagnostic._id,
          domainesCertification,
          actif: true
        });
        countCreated++;
        console.log(`✅ Mapping créé pour ${diagnostic.code}`);
      }
    }

    res.json({
      message: `Initialisation terminée`,
      created: countCreated,
      skipped: countSkipped
    });
  } catch (error) {
    console.error('Erreur initialiserMappingsParDefaut:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Récupérer tous les diagnostics et domaines pour l'interface admin
 */
exports.getDiagnosticsEtDomaines = async (req, res) => {
  try {
    const diagnostics = await Diagnostic.find().sort({ nom: 1 });
    const domaines = await DomaineActivite.find({ actif: true }).sort({ nom: 1 });

    res.json({ diagnostics, domaines });
  } catch (error) {
    console.error('Erreur getDiagnosticsEtDomaines:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = exports;