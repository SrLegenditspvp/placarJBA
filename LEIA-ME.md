# JBA Placar de Basquete

Placar digital de basquete feito com **HTML, CSS e JavaScript puro**, sem frameworks e sem banco de dados. O projeto possui uma mesa de controle e uma tela de telão para o público.

## Como abrir

1. Extraia o arquivo `JBA-Placar.zip`.
2. Abra a pasta no Visual Studio Code.
3. Abra `index.html` com a extensão **Live Server** (recomendado) ou sirva a pasta por um servidor local.
4. Na mesa de controle, clique em **Abrir telão** para abrir `display.html` em outra aba/janela.

> Para a sincronização funcionar, abra as duas telas no mesmo navegador e no mesmo computador. A comunicação é feita por `localStorage` e `BroadcastChannel`.

## Equipes

A partida tem duas equipes por vez. Cada lado pode ser configurado para uma das quatro cores:

- Preto
- Amarelo
- Verde
- Azul

As duas equipes não podem usar a mesma cor simultaneamente.

## Recursos

- Placar com registro manual de +1, +2 e +3 pontos.
- Cronômetro principal com iniciar, pausar, reiniciar e ajustes de ±1 ou ±10 segundos.
- Relógio de arremesso com 24s e 14s, iniciar e pausar.
- Quatro quartos e prorrogações, com duração configurável.
- Faltas coletivas e aviso visual ao atingir o limite configurado.
- Pedidos de tempo por equipe, com contagem de tempos restantes e cronômetro próprio.
- Seta de posse alternada.
- Pontuação parcial por quarto e prorrogação.
- Histórico de ações da partida.
- Desfazer a última ação.
- Salvamento automático no navegador.
- Exportação e importação de backup JSON.
- Tela de telão sincronizada com a mesa.
- Layout responsivo para computador, tablet e celular.

## Configuração inicial

O padrão inicial é uma referência comum FIBA: 4 quartos de 10 minutos, prorrogações de 5 minutos, relógio de arremesso de 24 segundos, 2 tempos no primeiro tempo, 3 no segundo e 1 por prorrogação. Ajuste de acordo com o regulamento oficial de cada categoria da JBA.

## Observações importantes

- O placar não substitui a súmula oficial nem as decisões da arbitragem.
- O botão `+ Falta` registra somente faltas coletivas; não há cadastro ou estatísticas individuais de atletas.
- Os dados ficam salvos no navegador utilizado. Exporte o backup após a partida para manter uma cópia.
- Não limpe os dados do navegador antes de exportar o backup.
- Para uma operação em computadores diferentes, será necessário desenvolver uma versão com servidor e sincronização pela rede/internet.
