const Diagnostiqueur = require('../models/Diagnostiqueur');
const Certification = require('../models/Certification');
const DomaineActivite = require('../models/DomaineActivite');
const TechnicienDiagnostiqueur = require('../models/TechnicienDiagnostiqueur');
const Pack = require('../models/Pack');
const Diagnostic = require('../models/Diagnostic');
const Devis = require('../models/Devis');
const JournalEligibilite = require('../models/JournalEligibilite');
const DiagnosticCertificationMapping = require('../models/DiagnosticCertificationMapping');

/**
 * Service d'éligibilité
 * Vérifie si un diagnostiqueur peut prendre une commande
 */

/**
 * Vérifie l'éligibilité complète d'un diagnostiqueur pour un devis
 */
async function verifierEligibilite(diagnostiqueurId, devisId) {
  const startTime = Date.now();

  try {
    // Vérifier si c'est un Admin - Bypass automatique
    const Admin = require('../models/Admin');
    const isAdmin = await Admin.findById(diagnostiqueurId);

    if (isAdmin) {
      console.log('✅ Admin détecté - Bypass éligibilité automatique');
      return {
        eligible: true,
        bypassAdmin: true,
        raisonsIneligibilite: [],
        diagnosticsVerifies: [],
        packsVerifies: [],
        certificationsManquantes: [],
        assurancesVerifiees: {
          rc: { valide: true },
          decennale: { valide: true }
        }
      };
    }

    // Récupérer le diagnostiqueur
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      throw new Error('Diagnostiqueur non trouvé');
    }

    // Récupérer le devis avec les références peuplées
    const devis = await Devis.findById(devisId)
      .populate('pack')
      .populate('diagnosticsSelectionnes')
      .populate('supplementsSelectionnes');

    if (!devis) {
      throw new Error('Devis non trouvé');
    }

    const resultat = {
      eligible: true,
      raisonsIneligibilite: [],
      diagnosticsVerifies: [],
      packsVerifies: [],
      certificationsManquantes: [],
      assurancesVerifiees: {}
    };

    // 1. Vérifier les assurances
    const assurancesOk = await verifierAssurances(diagnostiqueur);
    resultat.assurancesVerifiees = assurancesOk;

    if (!assurancesOk.rc.valide) {
      resultat.eligible = false;
      resultat.raisonsIneligibilite.push('Assurance RC expirée ou absente');
    }

    if (!assurancesOk.decennale.valide) {
      resultat.eligible = false;
      resultat.raisonsIneligibilite.push('Assurance décennale expirée ou absente');
    }

    // 2. Vérifier le pack si présent
    if (devis.pack) {
      const packEligible = await verifierEligibilitePack(diagnostiqueur, devis.pack._id);
      resultat.packsVerifies.push({
        packId: devis.pack._id,
        nom: devis.pack.nom,
        eligible: packEligible.eligible
      });

      if (!packEligible.eligible) {
        resultat.eligible = false;
        resultat.raisonsIneligibilite.push(...packEligible.raisons);
        resultat.certificationsManquantes.push(...packEligible.certificationsManquantes);
      }

      resultat.diagnosticsVerifies.push(...packEligible.diagnosticsVerifies);
    }

    // 3. Vérifier les diagnostics individuels
    if (devis.diagnosticsSelectionnes && devis.diagnosticsSelectionnes.length > 0) {
      for (const diagnostic of devis.diagnosticsSelectionnes) {
        const diagEligible = await verifierEligibiliteDiagnostic(diagnostiqueur, diagnostic._id);

        resultat.diagnosticsVerifies.push({
          diagnosticId: diagnostic._id,
          nom: diagnostic.nom,
          domaineCode: diagEligible.domaineCode,
          eligible: diagEligible.eligible,
          certificationTrouvee: diagEligible.certificationTrouvee
        });

        if (!diagEligible.eligible) {
          resultat.eligible = false;
          resultat.raisonsIneligibilite.push(diagEligible.raison);

          if (!diagEligible.certificationTrouvee && diagEligible.domaineCode !== 'SURFACE') {
            resultat.certificationsManquantes.push({
              domaineCode: diagEligible.domaineCode,
              nomDomaine: diagEligible.nomDomaine
            });
          }
        }
      }
    }

    // Calculer la durée
    const dureeMsCalcul = Date.now() - startTime;

    // Enregistrer dans le journal
    await JournalEligibilite.create({
      diagnostiqueur: diagnostiqueurId,
      devis: devisId,
      eligible: resultat.eligible,
      diagnosticsVerifies: resultat.diagnosticsVerifies,
      packsVerifies: resultat.packsVerifies,
      raisonsIneligibilite: resultat.raisonsIneligibilite,
      certificationsManquantes: resultat.certificationsManquantes,
      assurances: resultat.assurancesVerifiees,
      action: 'verification_simple',
      dureeMsCalcul
    });

    return resultat;

  } catch (error) {
    console.error('Erreur verifierEligibilite:', error);
    throw error;
  }
}

/**
 * Vérifie les assurances d'un diagnostiqueur
 */
async function verifierAssurances(diagnostiqueur) {
  const maintenant = new Date();
  const resultat = {
    rc: { valide: false, dateExpiration: null },
    decennale: { valide: false, dateExpiration: null }
  };

  // Vérifier RC
  const assuranceRC = diagnostiqueur.documents.find(
    doc => doc.type === 'assurance_rc' && doc.dateExpiration
  );

  if (assuranceRC) {
    resultat.rc.dateExpiration = assuranceRC.dateExpiration;
    resultat.rc.valide = assuranceRC.dateExpiration > maintenant;
  }

  // Vérifier décennale
  const assuranceDecennale = diagnostiqueur.documents.find(
    doc => doc.type === 'assurance_decennale' && doc.dateExpiration
  );

  if (assuranceDecennale) {
    resultat.decennale.dateExpiration = assuranceDecennale.dateExpiration;
    resultat.decennale.valide = assuranceDecennale.dateExpiration > maintenant;
  }

  return resultat;
}

/**
 * Vérifie l'éligibilité pour un pack complet
 */
async function verifierEligibilitePack(diagnostiqueur, packId) {
  try {
    const pack = await Pack.findById(packId).populate('diagnostics');

    if (!pack) {
      throw new Error('Pack non trouvé');
    }

    const resultat = {
      eligible: true,
      raisons: [],
      certificationsManquantes: [],
      diagnosticsVerifies: []
    };

    // Vérifier chaque diagnostic du pack
    if (!pack.diagnostics || pack.diagnostics.length === 0) {
      console.warn(`⚠️ Le pack ${pack.nom} n'a aucun diagnostic associé`);
      return resultat;
    }

    for (const diagnostic of pack.diagnostics) {
      const diagEligible = await verifierEligibiliteDiagnostic(diagnostiqueur, diagnostic._id);

      resultat.diagnosticsVerifies.push({
        diagnosticId: diagnostic._id,
        nom: diagnostic.nom,
        domaineCode: diagEligible.domaineCode,
        eligible: diagEligible.eligible,
        certificationTrouvee: diagEligible.certificationTrouvee
      });

      if (!diagEligible.eligible) {
        resultat.eligible = false;
        resultat.raisons.push(`Pack: ${diagEligible.raison}`);

        if (!diagEligible.certificationTrouvee && diagEligible.domaineCode !== 'SURFACE') {
          resultat.certificationsManquantes.push({
            domaineCode: diagEligible.domaineCode,
            nomDomaine: diagEligible.nomDomaine
          });
        }
      }
    }

    return resultat;

  } catch (error) {
    console.error('Erreur verifierEligibilitePack:', error);
    throw error;
  }
}

/**
 * Vérifie l'éligibilité pour un diagnostic individuel
 */
async function verifierEligibiliteDiagnostic(diagnostiqueur, diagnosticId) {
  try {
    console.log("====================================================");
    console.log("🔍 DÉBUT vérification éligibilité");
    console.log("Diagnostiqueur ID:", diagnostiqueur?._id);
    console.log("Diagnostic ID:", diagnosticId);
    console.log("Date actuelle:", new Date());
    console.log("====================================================");

    const diagnostic = await Diagnostic.findById(diagnosticId);

    if (!diagnostic) {
      console.log("❌ Diagnostic non trouvé");
      throw new Error('Diagnostic non trouvé');
    }

    console.log("✅ Diagnostic trouvé:", {
      id: diagnostic._id,
      nom: diagnostic.nom
    });

    // ============================
    // RECHERCHE MAPPING
    // ============================

    const mapping = await DiagnosticCertificationMapping.findOne({
      diagnostic: diagnosticId,
      actif: true
    }).populate('domainesCertification.domaine');

    if (mapping) {
      console.log("✅ Mapping trouvé:", mapping._id);
      console.log("Domaines configurés:", mapping.domainesCertification);
    } else {
      console.log("⚠️ Aucun mapping actif trouvé pour ce diagnostic");
    }

    // ============================
    // SI MAPPING CONFIGURÉ
    // ============================

    if (mapping && mapping.domainesCertification.length > 0) {

      const certificationsManquantes = [];

      for (const domaineCertif of mapping.domainesCertification) {

        console.log("----------------------------------------------------");
        console.log("🔎 Vérification domaine:", {
          domaineId: domaineCertif.domaine?._id,
          code: domaineCertif.domaine?.code,
          nom: domaineCertif.domaine?.nom,
          obligatoire: domaineCertif.obligatoire,
          mentionRequise: domaineCertif.mentionSpecialeRequise
        });

        if (!domaineCertif.obligatoire) {
          console.log("⏭ Domaine non obligatoire → ignoré");
          continue;
        }

        let certTrouvee = false;

        // ============================
        // 1️⃣ RECHERCHE SUR DIAGNOSTIQUEUR
        // ============================

        const queryDiagnostiqueur = {
          diagnostiqueur: diagnostiqueur._id,
          domaine: domaineCertif.domaine._id,
          'approbation.statutApprobation': 'approuve',
          statut: 'valide',
          dateExpiration: { $gt: new Date() }
        };

        if (domaineCertif.mentionSpecialeRequise) {
          queryDiagnostiqueur.mentionSpeciale = domaineCertif.mentionSpecialeRequise;
        }

        console.log("📤 Query diagnostiqueur:", queryDiagnostiqueur);

        const certDiag = await Certification.findOne(queryDiagnostiqueur);

        console.log("📥 Résultat certification diagnostiqueur:", certDiag);

        if (certDiag) {
          console.log("✅ Certification trouvée sur diagnostiqueur");
          certTrouvee = true;
        } else {

          console.log("❌ Aucune certification sur diagnostiqueur, recherche techniciens...");

          // ============================
          // 2️⃣ RECHERCHE SUR TECHNICIENS
          // ============================

          const techniciens = await TechnicienDiagnostiqueur.find({
            diagnostiqueur: diagnostiqueur._id,
            actif: true
          });

          console.log("👥 Techniciens trouvés:", techniciens.map(t => t._id));

          for (const technicien of techniciens) {

            const queryTechnicien = {
              technicien: technicien._id,
              domaine: domaineCertif.domaine._id,
              'approbation.statutApprobation': 'approuve',
              statut: 'valide',
              dateExpiration: { $gt: new Date() }
            };

            if (domaineCertif.mentionSpecialeRequise) {
              queryTechnicien.mentionSpeciale = domaineCertif.mentionSpecialeRequise;
            }

            console.log("📤 Query technicien:", queryTechnicien);

            const certTech = await Certification.findOne(queryTechnicien);

            console.log("📥 Résultat certification technicien:", certTech);

            if (certTech) {
              console.log("✅ Certification trouvée sur technicien:", technicien._id);
              certTrouvee = true;
              break;
            }
          }
        }

        if (!certTrouvee) {
          console.log("🚨 Certification MANQUANTE pour domaine:", domaineCertif.domaine.nom);

          certificationsManquantes.push({
            domaineCode: domaineCertif.domaine.code,
            nomDomaine: domaineCertif.domaine.nom,
            mentionSpeciale: domaineCertif.mentionSpecialeRequise
          });
        }
      }

      if (certificationsManquantes.length > 0) {
        console.log("❌ Certifications manquantes:", certificationsManquantes);

        return {
          eligible: false,
          raison: `Certifications manquantes pour ${diagnostic.nom}: ${certificationsManquantes.map(c => c.nomDomaine).join(', ')}`,
          domaineCode: certificationsManquantes[0].domaineCode,
          nomDomaine: certificationsManquantes[0].nomDomaine,
          certificationTrouvee: false,
          certificationsManquantes
        };
      }

      console.log("🎉 Toutes les certifications obligatoires sont présentes");

      return {
        eligible: true,
        raison: null,
        domaineCode: mapping.domainesCertification[0].domaine.code,
        nomDomaine: mapping.domainesCertification[0].domaine.nom,
        certificationTrouvee: true
      };
    }

    // ============================
    // FALLBACK
    // ============================

    console.log(`⚠️ FALLBACK activé pour diagnostic: ${diagnostic.nom}`);

    const domaine = await mapperDiagnosticVersDomaine(diagnostic.nom);

    console.log("📌 Domaine mappé:", domaine);

    if (!domaine) {
      console.log("❌ Aucun domaine trouvé dans fallback");
      return {
        eligible: false,
        raison: `Domaine non trouvé pour le diagnostic: ${diagnostic.nom}`,
        domaineCode: null,
        nomDomaine: null,
        certificationTrouvee: false
      };
    }

    if (domaine.code === 'SURFACE') {
      console.log("✅ Domaine SURFACE → pas besoin de certification");
      return {
        eligible: true,
        raison: null,
        domaineCode: 'SURFACE',
        nomDomaine: domaine.nom,
        certificationTrouvee: true
      };
    }

    console.log("🔎 Vérification certification via aCertificationValide...");
    console.log("Diagnostiqueur ID:", diagnostiqueur._id);
    console.log("Domaine ID:", domaine._id);

    const certificationValide = await aCertificationValide(
      diagnostiqueur._id,
      domaine._id
    );

    console.log("📥 Résultat aCertificationValide:", certificationValide);

    if (!certificationValide) {
      console.log("🚨 Certification invalide ou expirée");

      return {
        eligible: false,
        raison: `Certification manquante ou expirée pour: ${domaine.nom}`,
        domaineCode: domaine.code,
        nomDomaine: domaine.nom,
        certificationTrouvee: false
      };
    }

    console.log("🎉 Certification valide trouvée (fallback)");

    return {
      eligible: true,
      raison: null,
      domaineCode: domaine.code,
      nomDomaine: domaine.nom,
      certificationTrouvee: true
    };

  } catch (error) {
    console.error('💥 Erreur verifierEligibiliteDiagnostic:', error);
    throw error;
  }
}

/**
 * Mapper un diagnostic vers un domaine d'activité
 */
async function mapperDiagnosticVersDomaine(nomDiagnostic) {
  try {
    const nomUpper = nomDiagnostic.toUpperCase();

    // Mapping basé sur le nom du diagnostic
    let codeRecherche = null;

    if (nomUpper.includes('DPE')) codeRecherche = 'DPE';
    else if (nomUpper.includes('AMIANTE')) codeRecherche = 'AMIANTE';
    else if (nomUpper.includes('PLOMB')) codeRecherche = 'PLOMB';
    else if (nomUpper.includes('TERMITE')) codeRecherche = 'TERMITES';
    else if (nomUpper.includes('GAZ')) codeRecherche = 'GAZ';
    else if (nomUpper.includes('ÉLECTRICITÉ') || nomUpper.includes('ELECTRICITE')) codeRecherche = 'ELECTRICITE';
    else if (nomUpper.includes('ERP')) codeRecherche = 'ERP';
    else if (nomUpper.includes('CARREZ')) codeRecherche = 'CARREZ';
    else if (nomUpper.includes('BOUTIN')) codeRecherche = 'BOUTIN';
    else if (nomUpper.includes('SURFACE')) codeRecherche = 'SURFACE';
    else if (nomUpper.includes('ASSAINISSEMENT')) codeRecherche = 'ASSAINISSEMENT';
    else if (nomUpper.includes('MESURAGE')) codeRecherche = 'MESURAGE';
    else if (nomUpper.includes('MÉRULE') || nomUpper.includes('MERULE')) codeRecherche = 'MERULES';

    if (!codeRecherche) {
      console.warn(`Aucun mapping trouvé pour le diagnostic: ${nomDiagnostic}`);
      return null;
    }

    const domaine = await DomaineActivite.findOne({ code: codeRecherche, actif: true });
    return domaine;

  } catch (error) {
    console.error('Erreur mapperDiagnosticVersDomaine:', error);
    throw error;
  }
}

/**
 * Vérifie si le diagnostiqueur a une certification valide pour un domaine
 */
async function aCertificationValide(diagnostiqueurId, domaineId) {
  try {
    // 1. Chercher une certification directement sur le diagnostiqueur
    let certification = await Certification.findOne({
      diagnostiqueur: diagnostiqueurId,
      domaine: domaineId,
      'approbation.statutApprobation': 'approuve',
      statut: 'valide',
      dateExpiration: { $gt: new Date() }
    });

    if (certification) {
      return true;
    }

    // 2. Si pas trouvé, chercher parmi les techniciens du diagnostiqueur
    const techniciens = await TechnicienDiagnostiqueur.find({
      diagnostiqueur: diagnostiqueurId,
      actif: true
    });

    if (techniciens.length === 0) {
      console.log(`ℹ️ Aucun technicien actif trouvé pour le diagnostiqueur ${diagnostiqueurId}`);
      return false;
    }

    // Chercher une certification valide parmi les techniciens
    for (const technicien of techniciens) {
      certification = await Certification.findOne({
        technicien: technicien._id,
        domaine: domaineId,
        'approbation.statutApprobation': 'approuve',
        statut: 'valide',
        dateExpiration: { $gt: new Date() }
      });

      if (certification) {
        console.log(`✅ Certification valide trouvée pour le technicien ${technicien.nom} ${technicien.prenom}`);
        return true;
      }
    }

    console.log(`❌ Aucune certification valide trouvée pour le domaine ${domaineId}`);
    return false;

  } catch (error) {
    console.error('Erreur aCertificationValide:', error);
    throw error;
  }
}

module.exports = {
  verifierEligibilite,
  verifierAssurances,
  verifierEligibilitePack,
  verifierEligibiliteDiagnostic,
  mapperDiagnosticVersDomaine,
  aCertificationValide
};
