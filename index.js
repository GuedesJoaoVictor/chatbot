import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason
} from '@whiskeysockets/baileys';
import 'dotenv/config';
import P from 'pino';
import qrcode from 'qrcode-terminal';

const GREETING_REGEX = /\b(oi|ola|bom dia|boa tarde|boa noite|tudo (bem|bom)\/?|ola!|olá!|oie|eai|opa)\b/;
const MENU_REGEX = /\b(menu|voltar|inicio|início|0)\b/;
const greetedUsers = new Map();
const COOLDOWN = 1000 * 60 * 60 * 14;
const userState = new Map();
const RESET_REGEX = /\b(reiniciar|reset|começar de novo)\b/;

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function sendMenu(sock, from, name) {
  await sock.sendMessage(from, {
    text:
      `📋 *Menu de Atendimento*${name ? `, ${name}` : ''}\n\n` +
      '1️⃣ Marcar experimental\n' +
      '2️⃣ Conhecer a unidade\n' +
      '3️⃣ Problemas no Tecnofit\n' +
      '4️⃣ Renovação/Cancelamento de plano\n' +
      '5️⃣ Falar com o consultor\n\n' +
      '_Digite *menu* a qualquer momento para voltar aqui._'
  });
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // MOSTRA QR CODE
        if (qr) {
            console.log('📱 Escaneie o QR Code abaixo:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('🤖 Bot conectado ao WhatsApp!');
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;

            if (reason === DisconnectReason.loggedOut) {
                console.log('❌ Deslogado. Apague a pasta auth e escaneie novamente.');
            } else {
                console.log('⚠️ Conexão caiu, reconectando...');
                startBot();
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const rawText =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text;

        if (!rawText) return;

        const text = normalize(rawText);
        const from = msg.key.remoteJid;
        const now = Date.now();

        const state = userState.get(from) || { step: 'START' };

        if (MENU_REGEX.test(text)) {
            const current = userState.get(from);

            if (!current?.name) {
                await sock.sendMessage(from, {
                text: 'Antes, me diga seu *nome* 😄'
                });
                userState.set(from, { step: 'ASK_NAME' });
                return;
            }

            userState.set(from, {
                step: 'ASK_TOPIC',
                name: current.name
            });

            await sendMenu(sock, from, current.name);
            return;
        }
        if (RESET_REGEX.test(text)) {
            userState.delete(from);
            greetedUsers.delete(from);

            await sock.sendMessage(from, {
                text: '🔄 Atendimento reiniciado. Pode me dar um *oi* 😊'
            });
            return;
        }

        // STEP 1
        if (state.step === 'START' && GREETING_REGEX.test(text)) {
            const lastGreeting = greetedUsers.get(from);

            if (!lastGreeting || now - lastGreeting > COOLDOWN) {
                greetedUsers.set(from, now);

                await sock.sendMessage(from, {
                    text: 'Olá! Tudo bem? 🤗 Seja bem-vindo à *SuperForce Veráz* 🏋🏻‍♀️'
                });

                setTimeout(async () => {
                    await sock.sendMessage(from, {
                        text: 'Para agilizarmos seu atendimento, me diga seu *nome* 😄'
                    });
                }, 1500);

                userState.set(from, { step: 'ASK_NAME' });
            }

            return;
        }

        // STEP 2
        if (state.step === 'ASK_NAME') {
            const name = rawText.split(' ')[0];

            userState.set(from, {
                step: 'ASK_TOPIC',
                name
            });

            await sock.sendMessage(from, {
                text: `Certo, *${name}*! Qual assunto você gostaria de falar?`
            });

            setTimeout(async () => {
                await sock.sendMessage(from, {
                    text:
                        '1️⃣ Marcar experimental\n' +
                        '2️⃣ Conhecer a unidade\n' +
                        '3️⃣ Problemas no Tecnofit\n' +
                        '4️⃣ Renovação/Cancelamento de plano\n' +
                        '5️⃣ Falar com o consultor\n\n' +
                        '_Digite *menu* a qualquer momento para voltar aqui._'
                });
            }, 1200);

            return;
        }

        // STEP 3
        if (state.step === 'ASK_TOPIC') {
            let response;

            switch (text) {
                case '1':
                case 'marcar experimental':
                    response = `Perfeito, vou registrar aqui sua aula experimental conosco!

E para deixarmos tudo pronto para tua aula na SuperForce, preciso te pedir um favor!
Você poderia preencher o formulário no link abaixo? 

Trata-se de uma Anamnese para que possamos saber um pouquinho mais de questões relacionadas a tua saúde e dessa forma te oferecer uma aula ainda mais segura e personalizada!

https://form.jotform.com/superforcemkt/anamnese-superforce

Quando finalizar de preencher, me sinalize aqui, por favor!`;
                    break;

                case '2':
                case 'conhecer a unidade':
                    response = 
                    `Na Veráz, é uma unidade de CrossFit que atende com turma pela manhã, tarde e noite, com flexibilidade de horários para quem deseja treinar.
O CrossFit é uma modalidade de treino funcional de alta intensidade que combina força, resistência e condicionamento físico. 
Também oferecemos Open Box para treinos livres para que os alunos possam realizar seus treinos de forma independente.

📍 A SuperForce Veráz está localizada na Rua Gaspar Martins, nº 1751, loja 3.`;
                    break;

                case '3':
                case 'problemas no tecnofit':
                    response = 'Só um momento, iremos repassar seu atendimento para um consultor 😊';
                    break;

                case '4':
                case 'renovacao':
                case 'cancelamento':
                    response = 'Claro! 🤗 Poderia me informar seu nome completo e CPF, juntamente com a confirmação se deseja renovar ou cancelar o plano?';
                    break;

                case '5':
                case 'falar com o consultor':
                    response = 'Só um momento, iremos repassar seu atendimento para um consultor 😊';
                    break;

                default:
                    await sock.sendMessage(from, {
                        text: '❓ Não entendi. Escolha uma opção de *1 a 5*.'
                    });
                    return;
            }

            await sock.sendMessage(from, { text: response });
            if (text === '4') {
                setTimeout(async () => {
                    await sock.sendMessage(from, {
                        text: `Só um momento, iremos repassar seu atendimento para um consultor 😊`
                    });
                }, 1500)
            } else if (text === '2') {
                setTimeout(async () => {
                    await sock.sendMessage(from, {
                        text: `Esses são nossos horários: 

SEGUNDA FEIRA 6:10, 7:10, 8:10, 11:10, 12:10, 16:10, 17:10, 18:10 E 19:10

TERÇA FEIRA 6:10, 7:10, 11:10, 17:10, 18:10 E 19:10

QUARTA FEIRA 6:10, 7:10, 8:10, 11:10, 12:10, 16:10, 17:10, 18:10 E 19:10

QUINTA FEIRA 6:10, 7:10, 11:10, 17:10, 18:10 E 19:10

SEXTA FEIRA 6:10, 7:10, 8:10, 11:10, 12:10, 16:10, 17:10, 18:10 E 19:10`
                    });
                }, 2000);
            }
            userState.set(from, { ...state, step: 'DONE' });
            return;
        }
    });
}
startBot();
