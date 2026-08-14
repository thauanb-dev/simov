# SIMOV WEB - UI Melhorada

Extensão do Chrome que melhora a interface do SIMOV WEB (`simovweb.ba.gov.br`) sem
alterar nenhum dado ou comportamento do sistema — só CSS e pequenos ajustes de UI
por cima do HTML que o próprio site já entrega. Foco em minimalismo e em dar
espaço pra ver várias informações de uma vez (menos chrome decorativo, mais
área útil pra dados).

## O que ela faz

- **Reskin minimalista e denso**: tipografia, espaçamento e cores mais
  compactos no menu lateral, topo, painel de pesquisa, botões e grid de
  resultados (zebra + hover). Layout fluido (sem largura máxima fixa), então
  aproveita bem tanto um monitor largo quanto uma janela estreita ancorada ao
  lado de outro app.
- **Painel de pesquisa recolhível**: cabeçalho "PESQUISA" clicável esconde o
  formulário inteiro pra sobrar altura de tela pra grid de resultados. Estado
  salvo.
- **Campos de pesquisa em grade compacta**: os filtros fluem em colunas lado a
  lado (em vez de um campo por linha), aproveitando a largura disponível.
- **Filtro nos combos grandes**: qualquer `<select>` com 12+ opções (ex.:
  Município, com 400+ cidades) ganha uma caixa de texto acima para filtrar as
  opções por nome, ignorando acentos.
- **Cabeçalho da grid fixo ao rolar**: em listas longas, os nomes das colunas
  continuam visíveis sem precisar voltar ao topo — útil pra comparar várias
  linhas de uma vez.
- **Menu lateral recolhível**: botão ☰ (ao lado do "a/A" de acessibilidade)
  esconde a coluna de navegação e libera largura pro conteúdo. Estado salvo.
- **Tema escuro "Matrix"**: botão flutuante (◐) no canto inferior direito
  alterna pra um tema escuro na mesma paleta usada no NeroDesk — preto quase
  puro, verde neon de destaque, grid de fundo sutil e dados da grid em fonte
  monoespaçada. Estado salvo.
- **"Relatório da Vistoria" (Ficha Resumo) abre em aba, não em popup**: o
  SIMOV normalmente força esse relatório numa mini-janela sem barra de
  ferramentas (`window.open(...,'toolbar=no,...')`). A extensão substitui
  esse `window.open` no contexto real da página assim que a página carrega,
  então quando o SIMOV chama a função depois (ao clicar no ícone da ficha),
  ela abre como aba normal — mesma janela do navegador, sem popup travado.
- **Topo consolidado numa unica barra**: as abas nativas "Pesquisa"/"Cadastro"
  (redundantes com o painel recolhível e o link "novo") e "Suporte"/"Ajuda"
  somem; o que sobra (usuário, logoff, tamanho de fonte, recolher menu,
  módulo atual) fica numa única barra compacta de 39px.
- **Busca rápida por código**: caixa flutuante no canto inferior direito —
  digita o código do imóvel e Enter, sem precisar abrir o painel de pesquisa
  inteiro. Guarda os últimos códigos pesquisados como atalhos clicáveis logo
  abaixo (o SIMOV faz postback completo a cada navegação e não lembra de
  nada).
- **Copiar linha da grid como texto**: ícone (⧉) em cada linha de resultado
  copia código/descrição/situação/data formatados — pronto pra colar num
  relatório ou email. Funciona mesmo o SIMOV rodando em `http://` sem TLS
  (usa um fallback de cópia compatível com contexto não-seguro).
- **Aviso ao sair de formulário com dados não salvos**: se você começar a
  preencher um cadastro/edição e tentar fechar a aba ou navegar pra outro
  lugar sem salvar, o navegador avisa antes — o SIMOV não tem essa proteção
  nativa, e um postback perdido descarta tudo silenciosamente.
- Tudo isso é reaplicado automaticamente depois de buscas/paginação, porque o
  SIMOV usa `UpdatePanel` (postback parcial via AJAX) e troca o HTML por
  baixo dos panos.

Não mexe em nenhum `<form>`, endpoint, viewstate ou botão de ação (novo, editar,
excluir, etc.) — só estilo e elementos extras que não interferem no postback.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome (ou Edge: `edge://extensions`).
2. Ative **"Modo do desenvolvedor"** (canto superior direito).
3. Clique em **"Carregar sem compactação"** (Load unpacked).
4. Selecione esta pasta (`CODE/simov/extension`).
5. Acesse `http://simovweb.ba.gov.br` normalmente — a extensão já aplica.

## Estrutura

- `manifest.json` — configuração (Manifest V3), roda em qualquer página de
  `simovweb.ba.gov.br`.
- `content.css` — todo o reskin visual, incluindo variáveis de tema
  claro/escuro (Matrix).
- `content.js` — filtro dos combos, painel de pesquisa recolhível, botão de
  recolher menu, botão de tema escuro, o patch do `window.open` (injetado via
  `<script>` no contexto real da página, pra funcionar em qualquer versão com
  Manifest V3), e o gancho no `PageRequestManager` para reaplicar após
  postback parcial.

## Observações

- Construída e validada a partir de uma cópia salva do HTML real do módulo de
  Vistoria (`view-source_simovweb.ba.gov.br_vistoria_Default.aspx.html`), com
  captura de tela via Edge headless para conferir o resultado visual — mas
  nunca testada contra o site ao vivo (sem acesso de rede a
  `simovweb.ba.gov.br` neste ambiente). Os seletores usados (`.gridview`,
  `.search`, `#menu`, `.form_group`, `#topo` etc.) são específicos desse
  template e devem valer para os outros módulos do sistema, que compartilham
  o mesmo layout — mas vale conferir visualmente ao instalar, e ajustar o CSS
  se algum módulo tiver uma estrutura diferente.
- O cabeçalho fixo da grid (`position: sticky`) usa um recurso padrão de CSS
  sem nenhuma dependência exótica, mas não foi possível confirmar com
  screenshot de rolagem real neste ambiente (limitação do harness de teste
  headless usado aqui, não do código) — vale um olhar rápido ao instalar.
- Se algo ficar estranho em algum combo pequeno ou campo específico, é seguro
  desativar a extensão a qualquer momento em `chrome://extensions` — nenhuma
  alteração é permanente ou afeta o servidor.
- **Depois de qualquer atualização destes arquivos**, é preciso clicar em
  "Recarregar" no card da extensão em `chrome://extensions` — o Chrome não
  detecta mudanças em arquivos de uma extensão "sem compactação" sozinho.
