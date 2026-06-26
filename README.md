# Pizzinatto Dashboard — Deploy no Render

## Passos

1. Crie uma conta em https://render.com (gratuito)
2. Clique em **New → Web Service**
3. Conecte seu GitHub e faça upload desta pasta
   (ou use: New → Web Service → Deploy from Git → cole o repositório)
4. Configure:
   - **Name:** pizzinatto-dashboard
   - **Runtime:** Node
   - **Build Command:** (deixe vazio)
   - **Start Command:** node server.js
5. Em **Environment Variables**, adicione:
   - `SMCLICK_EMAIL` → seu email do SMClick
   - `SMCLICK_PASSWORD` → sua senha do SMClick
6. Clique em **Create Web Service**

Pronto! O dashboard fica disponível em:
https://pizzinatto-dashboard.onrender.com

## Sem GitHub

Se não quiser usar GitHub, instale o Render CLI:
  npm install -g @render-com/cli
  render deploy
