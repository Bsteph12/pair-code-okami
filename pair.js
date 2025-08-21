import express from 'express';
import fs from 'fs/promises'; // On utilise la version promesse de fs pour un code plus propre
import path from 'path';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';
import JSZip from 'jszip';

const router = express.Router();

// Fonction pour supprimer un dossier
async function removeDirectory(dirPath) {
    try {
        await fs.rm(dirPath, { recursive: true, force: true });
    } catch (e) {
        console.error('Erreur lors de la suppression du dossier:', e);
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) {
        return res.status(400).send({ error: 'Le numéro est requis' });
    }

    const sessionDir = path.join('./sessions', num.replace(/[^0-9]/g, ''));

    try {
        await removeDirectory(sessionDir); // Nettoie l'ancienne session
        await fs.mkdir(sessionDir, { recursive: true }); // Crée le dossier de session

        const phone = pn('+' + num);
        if (!phone.isValid()) {
            return res.status(400).send({ error: 'Numéro de téléphone invalide.' });
        }
        num = phone.getNumber('e164');

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.windows('Safari'),
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log("✅ Connexion ouverte, envoi de la session ZIP...");
                
                await delay(5000); // Délai crucial pour s'assurer que tous les fichiers de session sont écrits

                const zip = new JSZip();
                const files = await fs.readdir(sessionDir);

                for (const file of files) {
                    const data = await fs.readFile(path.join(sessionDir, file));
                    zip.file(file, data);
                }

                const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

                // Envoi de l'archive ZIP à l'utilisateur
                const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                await sock.sendMessage(userJid, {
                    document: zipBuffer,
                    mimetype: 'application/zip',
                    fileName: 'session.zip'
                });
                
                // Envoi du message d'avertissement
                await sock.sendMessage(userJid, { text: `⚠️ Ne partagez ce fichier avec personne !\n\nMerci d'utiliser notre service.` });

                await delay(2000); // Petit délai avant de fermer la connexion
                sock.end(); // Ferme la connexion proprement
            }

            if (connection === 'close') {
                await removeDirectory(sessionDir); // Nettoie le dossier après la déconnexion
                console.log("🔁 Connexion fermée, session nettoyée.");
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Demande du code de pairage
        if (!sock.authState.creds.registered) {
            await delay(1500);
            let code = await sock.requestPairingCode(num);
            code = code?.match(/.{1,4}/g)?.join('-') || code;
            res.send({ code });
        }

    } catch (err) {
        console.error('Erreur dans le processus de pairage:', err);
        await removeDirectory(sessionDir);
        res.status(500).send({ error: 'Une erreur est survenue.' });
    }
});

export default router;
