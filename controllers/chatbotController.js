require('dotenv').config();
const OpenAI = require('openai');
const Devis = require('../models/Devis');
const Client = require('../models/Client');
const Agence = require('../models/Agency');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * EXECUTE LA RECHERCHE REELLE EN BASE DE DONNEES
 */
async function performSearch(role, agenceId, queryType, searchParams = {}) {
    // IMPORTANT : On utilise agenceId car c'est le nom dans ton schéma Devis
    const filter = (role === 'admin') ? {} : { agenceId: agenceId };
    
    try {
        switch (queryType) {
            case 'stats':
                const total = await Devis.countDocuments(filter);
                const acceptes = await Devis.countDocuments({ ...filter, statut: 'Accepté' });
                const envoyes = await Devis.countDocuments({ ...filter, statut: 'Envoyé' });
                // On renvoie les vrais chiffres de la DB
                return { 
                    totalDevis: total, 
                    details: { acceptes, envoyes, autres: total - (acceptes + envoyes) },
                    message: `Tu as trouvé ${total} devis dans la base de données.` 
                };
            
            case 'list_devis':
                const list = await Devis.find(filter).sort({ dateCreation: -1 }).limit(10);
                return list.map(d => ({ 
                    numero: d.numero, 
                    client: `${d.client?.nom || 'N/A'} ${d.client?.prenom || ''}`, 
                    montant: d.montantTTC, 
                    statut: d.statut 
                }));

            case 'client_info':
                const clientFilter = (role === 'admin') 
                    ? { email: searchParams.email } 
                    : { email: searchParams.email, agences: agenceId };
                return await Client.findOne(clientFilter);

            default:
                return { error: "Type de recherche inconnu" };
        }
    } catch (err) {
        console.error("Erreur DB Chatbot:", err);
        return { error: "Erreur lors de la lecture de la base de données" };
    }
}

/**
 * TOOLS DEFINITION
 */
const tools = [
    {
        type: "function",
        function: {
            name: "get_platform_data",
            description: "Récupère les statistiques réelles, le nombre de devis ou des infos clients depuis la base de données.",
            parameters: {
                type: "object",
                properties: {
                    queryType: { type: "string", enum: ["stats", "list_devis", "client_info"] },
                    email: { type: "string", description: "Requis si queryType est client_info" }
                },
                required: ["queryType"]
            }
        }
    }
];

exports.chat = async (req, res) => {
    try {
        const { message, conversationHistory = [] } = req.body;
        const role = req.role; 
        const agenceId = req.agence?._id; // Récupéré via combinedAuth -> agencyAuth

        let messages = [
            { 
                role: 'system', 
                content: `Tu es l'assistant DIMOTEC. Tu ne dois JAMAIS inventer de chiffres. 
                Si l'utilisateur pose une question sur ses devis ou chiffres, utilise l'outil 'get_platform_data'. 
                Réponds toujours sur la base des résultats fournis par l'outil.` 
            },
            ...conversationHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message }
        ];

        // 1. Appel OpenAI pour décider s'il faut utiliser l'outil
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages,
            tools
        });

        const assistantMessage = response.choices[0].message;

        // 2. Si l'IA veut appeler l'outil (C'est ici que le "51" est récupéré)
        if (assistantMessage.tool_calls) {
            messages.push(assistantMessage);

            for (const toolCall of assistantMessage.tool_calls) {
                const args = JSON.parse(toolCall.function.arguments);
                const toolResult = await performSearch(role, agenceId, args.queryType, args);

                messages.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: JSON.stringify(toolResult)
                });
            }

            // 3. Appel final avec les vraies données injectées
            const finalResponse = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages
            });

            return res.json({ response: finalResponse.choices[0].message.content });
        }

        res.json({ response: assistantMessage.content });

    } catch (error) {
        console.error('Chatbot Error:', error);
        res.status(500).json({ error: "Erreur du serveur" });
    }
};

exports.getSuggestions = async (req, res) => {
    const suggestions = req.role === 'admin' 
        ? ["Stats globales", "Liste agences"] 
        : ["Combien j'ai de devis ?", "Derniers clients"];
    res.json({ suggestions });
};