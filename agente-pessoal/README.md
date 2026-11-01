# Agente pessoal de agenda

Web app + agente que roda 24h: lembretes por **push** e **WhatsApp**, resumo do dia
toda manha e sincronizacao com o **Outlook pessoal**. Sem dependencias (so Node 22.13+).

```
Web app ──► SQLite ──► Outlook (Microsoft Graph)
              │
         scheduler (a cada minuto) ──► push (ntfy) + WhatsApp
```

- Item **com horario** = compromisso: vai para o Outlook e gera lembrete.
- Item **sem horario** = tarefa: entra no resumo do dia por prioridade; nao vai para o Outlook.
- Todo dia no `DAILY_PLAN_AT` chega o plano: compromissos, tarefas e horarios livres.

## 1. Rodar local

```bash
cp .env.example .env     # edite APP_TOKEN e NTFY_TOPIC
npm start                # http://localhost:3000
npm test
```

## 2. Push (5 min)
1. Instale o app **ntfy** (Android/iOS).
2. Assine o topico que voce colocou em `NTFY_TOPIC` (use um nome longo e dificil de adivinhar: quem souber o nome le suas mensagens).
3. No app web, clique em "Enviar notificacao de teste".

## 3. Outlook pessoal
1. https://entra.microsoft.com → Aplicativos → Registros de aplicativo → **Novo registro**.
2. Tipos de conta: **"Somente contas pessoais da Microsoft"**.
3. Autenticacao → habilite **"Permitir fluxos de cliente publico"** = Sim.
4. Permissoes de API → Microsoft Graph → Delegadas → `Calendars.ReadWrite`.
5. Copie o **ID do aplicativo (cliente)** para `MS_CLIENT_ID` no `.env`.
6. `npm run auth:outlook` e siga o codigo mostrado. O token fica em `data/ms_token.json`.

Se o Outlook cair, o app e os lembretes continuam funcionando (a sincronizacao e melhor esforco).
Hoje a sincronizacao e **so de ida** (app → Outlook). Eventos criados direto no Outlook nao aparecem no app.

## 4. WhatsApp (opcional, mais trabalhoso)
Use a API oficial da Meta (WhatsApp Cloud API): https://developers.facebook.com/docs/whatsapp/cloud-api
- Preencha `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TO`.
- Texto livre so e entregue **dentro de 24h depois que voce escreve para o numero**. Para lembretes
  automaticos crie um template com uma variavel `{{1}}` no corpo, aprove-o e coloque o nome em `WHATSAPP_TEMPLATE`.
- Use um token permanente (usuario do sistema); o token temporario expira em 24h.

## 5. Deixar rodando 24h (Fly.io, no Mac)
O app precisa de um servidor sempre ligado e de um disco persistente para `data/` (banco SQLite + token do Outlook).

```bash
brew install flyctl            # ou: curl -L https://fly.io/install.sh | sh
fly auth signup                # ou: fly auth login (pede cartao de credito)
```
1. Edite `fly.toml` e troque `agenda-giselle-troque` por um nome unico seu (letras minusculas e hifens).
2. Crie o app e o disco (1 GB, regiao Sao Paulo):
   ```bash
   fly apps create SEU-NOME
   fly volumes create agenda_data --region gru --size 1
   ```
3. Guarde as senhas como segredos do servidor (nunca no codigo; o `.env` nao vai junto no deploy):
   ```bash
   fly secrets set APP_TOKEN='senha-longa-com-12+-caracteres' NTFY_TOPIC='seu-topico'
   ```
4. Publique com **uma unica maquina** (o disco e de uma maquina so):
   ```bash
   fly deploy --ha=false
   ```
5. Abra `https://SEU-NOME.fly.dev`, entre com a senha e use o botao de notificacao de teste.
6. No celular: Safari → abrir o endereco → Compartilhar → "Adicionar a Tela de Inicio".

Depois de 10 senhas erradas seguidas o IP fica bloqueado por 15 minutos. Em producao o `APP_TOKEN` precisa ter pelo menos 12 caracteres.

Para atualizar depois: `fly deploy --ha=false`. Para ver logs: `fly logs`.
Para o Outlook no servidor: rode `npm run auth:outlook` no Mac e depois `fly ssh sftp shell` para enviar `data/ms_token.json` para `/app/data/` (ou rode o comando dentro de `fly ssh console`).

## Proximos passos possiveis
- Importar eventos do Outlook para o app (sincronizacao nos dois sentidos).
- Cadastrar tarefas respondendo no WhatsApp.
- Sugerir horario automaticamente para tarefas nos horarios livres.
