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

## 5. Deixar rodando 24h
Precisa de um lugar sempre ligado e com volume persistente para `data/` (SQLite + token do Outlook).
Exemplos: Fly.io, Railway, Render (com disco), ou uma VPS barata.

```bash
docker build -t agente-pessoal .
docker run -d --restart=always -p 3000:3000 --env-file .env -v agenda-data:/app/data agente-pessoal
```

Coloque HTTPS na frente (Fly/Railway/Render ja fazem isso) porque a senha do app trafega no cabecalho.

## Proximos passos possiveis
- Importar eventos do Outlook para o app (sincronizacao nos dois sentidos).
- Cadastrar tarefas respondendo no WhatsApp.
- Sugerir horario automaticamente para tarefas nos horarios livres.
