import express from 'express';
import fs from 'fs';
import pino from 'pino';
// --- MODIFICATION : Utilisation de baileys-x et ajout des fonctions nécessaires ---
import {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from 'baileys-x';
import pn from 'awesome-phonenumber';

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (fs.existsSync(FilePath)) {
            fs.rmSync(FilePath, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    const sessionDir = './' + (num || `session_temp`);

    await removeFile(sessionDir);

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Numéro de téléphone invalide.' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        try {
            const { version } = await fetchLatestBaileysVersion();
            // --- MODIFICATION : Configuration du socket identique à celle de votre bot ---
            let zoroBotSession = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.ubuntu('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            });

            zoroBotSession.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    console.log("✅ Connexion temporaire établie !");
                    
                    try {
                        const sessionFile = fs.readFileSync(`${sessionDir}/creds.json`);
                        const userJid = jidNormalizedUser(`${num}@s.whatsapp.net`);

                        await zoroBotSession.sendMessage(userJid, {
                            document: sessionFile,
                            mimetype: 'application/json',
                            fileName: 'creds.json'
                        });
                        console.log("📄 Fichier de session envoyé.");

                        // --- Personnalisation des messages ---
                        await zoroBotSession.sendMessage(userJid, {
                            image: { url: 'https://i.postimg.cc/qvnPWzzj/Zoro-Edit-Roronoa-Zoro-Zoro-One-Piece-One-Piece-Edit-Anime-Edit-Manga-Art-One-Piece-Manga-Zoro-Fan-Art.jpg' },
                            caption: `*ZORO BOT est maintenant lié !*\n\nSuivez notre channel pour les mises à jour :\nhttps://whatsapp.com/channel/0029Vb6DrnUHAdNQtz2GC307`
                        });

                        await zoroBotSession.sendMessage(userJid, {
                            text: `⚠️Ne partagez ce fichier avec personne⚠️\n ┌┤⚔️  Merci d'utiliser Zoro Bot\n │└────────────┈ ⚔️\n │©2025 STEPH DEV\n └─────────────────┈ ⚔️\n\n`
                        });
                        console.log("⚠️ Message d'avertissement envoyé.");

                        await delay(2000);
                        removeFile(sessionDir);
                        await zoroBotSession.logout();
                        console.log("✅ Processus terminé avec succès !");

                    } catch (error) {
                        console.error("❌ Erreur lors de l'envoi des messages:", error);
                        removeFile(sessionDir);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode !== 401) {
                       initiateSession();
                    } else {
                       removeFile(sessionDir);
                       console.log('Connexion fermée par l\'utilisateur.');
                    }
                }
            });

            if (!zoroBotSession.authState.creds.registered) {
                await delay(1500);
                
                try {
                    // --- MODIFICATION : Utilisation du customPairingCode ---
                    const customPairingCode = "STEPHDEV";
                    console.log(`Demande du code de pairage custom "${customPairingCode}" pour ${num}`);
                    let code = await zoroBotSession.requestPairingCode(num, customPairingCode);
                    
                    if (!res.headersSent) {
                        // On envoie le code custom au frontend
                        res.send({ code: customPairingCode });
                    }
                } catch (error) {
                    console.error('Erreur lors de la demande du code de pairage:', error);
                    if (!res.headersSent) {
                        res.status(503).send({ code: 'Échec de la demande du code.' });
                    }
                }
            }

            zoroBotSession.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('Erreur lors de l\'initialisation de la session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Indisponible' });
            }
        }
    }

    await initiateSession();
});

export default router;
