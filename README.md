# Venda Segura

Sistema comercial para controle de crediario, clientes, parcelas e cobrancas por WhatsApp.

## Como abrir

Abra o arquivo `index.html` no navegador.

## Como publicar

### Vercel

1. Crie um repositorio no GitHub.
2. Envie estes arquivos para o repositorio.
3. Acesse a Vercel e importe o repositorio.
4. Use a configuracao padrao.
5. Nao precisa build command.

### Netlify

1. Crie um repositorio no GitHub.
2. Envie estes arquivos para o repositorio.
3. Acesse a Netlify e crie um novo site pelo repositorio.
4. Deixe build command vazio.
5. Use publish directory como `.`.

## O que funciona

- Tela comercial de entrada.
- Plano Essencial exibido por R$ 29,90/mes.
- Cadastro de clientes.
- Cadastro e edicao de dividas.
- Geracao automatica de parcelas mensais.
- Painel com clientes ativos, atrasados, total a receber e recebido.
- Filtros por nome, produto, data de cadastro, vencimento e status.
- Organizacao do cliente por dados pessoais e financeiro.
- Parcelas recolhidas por cliente.
- Historico do cliente.
- Mensagens editaveis para lembrete e atraso.
- Cobranca por WhatsApp.
- Exportacao e importacao de backup JSON.
- Termos de uso e politica de privacidade.

## Observacao comercial

Esta versao esta pronta para vender como sistema simples de controle. Os dados ficam no navegador do usuario e devem ser protegidos com backup. Para escalar como SaaS com login, varios usuarios e pagamento automatico, o proximo passo e adicionar banco de dados online e autenticacao.
