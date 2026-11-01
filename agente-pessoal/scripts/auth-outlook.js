// Alternativa por terminal: npm run auth:outlook (o app web tambem tem o botao "Conectar Outlook")
import { connectOutlook, outlookPending, outlookLastError } from '../src/outlook.js';

const { user_code, verification_uri } = await connectOutlook(() => console.log('Outlook conectado. Token salvo em data/ms_token.json'));
console.log(`\nAbra ${verification_uri} e digite o codigo: ${user_code}\n`);
while (outlookPending()) await new Promise((r) => setTimeout(r, 1000));
if (outlookLastError()) { console.error(outlookLastError()); process.exit(1); }
process.exit(0);
