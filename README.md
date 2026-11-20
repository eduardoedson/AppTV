<p align="center">
  <img src="assets/branding/apptv-logo.png" alt="AppTV" width="150">
</p>

<h1 align="center">AppTV</h1>

<p align="center">
  Biblioteca pessoal de filmes e séries para Android TV e Google TV.
</p>

<!-- APP_VERSION_START -->
<p align="center">
  <img alt="Versão 1.31" src="https://img.shields.io/badge/vers%C3%A3o-1.31-7C3AED">
  <img alt="Build 32" src="https://img.shields.io/badge/build-32-2563EB">
  <img alt="Android TV" src="https://img.shields.io/badge/plataforma-Android%20TV-16A34A">
  <img alt="Uso privado" src="https://img.shields.io/badge/distribui%C3%A7%C3%A3o-privada-374151">
</p>

> **Versão publicada:** `1.31` · **Build:** `32` · **Publicada em:** 20/11/2026
<!-- APP_VERSION_END -->

O AppTV é feito em React Native TV e transforma um catálogo JSON em uma experiência completa para controle remoto. Catálogo, vídeos, legendas e atualizações podem ficar no **Google Drive privado**, acessados pela API oficial com uma conta autorizada.

## Visão geral

| Área | O que oferece |
|---|---|
| Biblioteca | Abas Todos, Séries e Filmes, ordenação A–Z/Z–A e progresso |
| Reprodução | Retomada, avanço automático, faixas de áudio e legendas embutidas ou externas |
| Ao vivo | Grade diária com 5–8 episódios entre filmes, áudio pt-BR e legendas desligadas |
| Catálogo | JSON validado, fontes diretas ou Drive, cache e sincronização de séries |
| Atualizações | APK e manifesto publicados no Drive, com instalação pelo próprio app |

## Sumário

- [Funcionalidades](#funcionalidades)
- [Início rápido](#início-rápido)
- [Configuração do ambiente](#configuração-env)
- [Google Drive privado](#acesso-privado-ao-google-drive)
- [Catálogo](#catálogo)
- [Controle de versão e publicação](#controle-de-versão-e-publicação)
- [Scripts](#scripts)
- [Estrutura do projeto](#estrutura)
- [Limitações conhecidas](#limitações-conhecidas)

## Funcionalidades

- Biblioteca com capas, progresso de cada título e seção de continuar assistindo.
- Página inicial com abas **Todos**, **Séries** e **Filmes**, aberta em Todos, e ordenação **A–Z/Z–A**.
- Tela de detalhes com temporadas, episódios, progresso por episódio e marcação do último visto.
- Botão único de reprodução: retoma o episódio pela metade ou segue a ordem escolhida.
- **Ordem sequencial ou aleatória** por série. No aleatório, nenhum episódio se repete até completar o ciclo, e é possível escolher temporadas inteiras ou episódios específicos em "Configurar reprodução".
- Avanço automático entre episódios. Se um episódio falhar, o app mostra o erro e pula para o próximo após 10 segundos (pausa depois de 5 falhas seguidas).
- Progresso salvo em SQLite, com retomada exata ao reabrir o app.
- Várias versões por título (por exemplo Dublado e Legendado), com a escolha lembrada por série.
- Seleção de faixa de áudio e legenda durante a reprodução. Faixas embutidas são detectadas pelo player, legendas externas podem vir do catálogo e a opção **Desligada** fica sempre disponível quando há legendas.
- No **Ao vivo**, o app prefere áudio em português/pt-BR, mantém as legendas desligadas e renova automaticamente a autorização do Drive quando ela expira durante a reprodução.
- Quando filmes estão habilitados no **Ao vivo**, cada filme é separado do próximo por um bloco determinístico de 5 a 8 episódios de séries.
- O painel da programação permite alternar o conteúdo entre **Todos**, **Filmes** e **Séries**; a preferência fica salva na TV.
- Catálogo em cache para funcionar sem conexão.
- **Atualização do app pelo próprio app**: botão de versão no topo da biblioteca, com download e instalação do novo APK.

## Tecnologias

- React Native TV (`react-native-tvos` 0.83) com TypeScript
- React Navigation (native stack)
- `react-native-video` (Media3 / ExoPlayer)
- `react-native-nitro-sqlite` (progresso, filas e preferências) e AsyncStorage (configurações e cache)
- `react-native-dotenv` (variáveis do `.env`)
- AJV (validação do catálogo)
- Módulo nativo em Kotlin para instalar atualizações (`android/app/src/main/java/com/apptvclient/updater`)

## Início rápido

### Requisitos

- Node.js 20 ou superior
- Android Studio com Android SDK 36, Platform Tools e Emulator
- Java 17 (já incluído no Android Studio)
- Variável `ANDROID_HOME` apontando para o SDK (`%LOCALAPPDATA%\Android\Sdk`) e as pastas `platform-tools` e `emulator` no `Path`

### Instalação

```bash
npm install --legacy-peer-deps
cp .env.example .env
```

Preencha o `.env` conforme a seção abaixo.

## Configuração (`.env`)

| Variável | Descrição |
|---|---|
| `DEFAULT_CATALOG_URL` | URL usada quando não há outra salva no app. Aceita link de arquivo do Google Drive ou HTTPS direto. |
| `GOOGLE_DRIVE_API_KEY` | Opcional. Chave de API para arquivos **públicos** do Drive. Ignorada quando o login OAuth está configurado. |
| `GOOGLE_OAUTH_CLIENT_ID` | ID do cliente OAuth do tipo "App para computador". |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Chave secreta do mesmo cliente OAuth. |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Refresh token emitido para o mesmo cliente e para a conta que pode ler os arquivos privados. |
| `UPDATE_MANIFEST_URL` | Link do `AppTV.update.json` no Drive. Preenchido automaticamente por `scripts/publicar-apk.js`. |

Depois de alterar o `.env`, reinicie o Metro limpando o cache: `npm start -- --reset-cache`.

As variáveis são incorporadas ao bundle durante a compilação. Para que uma mudança chegue à TV, gere e instale um APK novo. O `.env` real é ignorado pelo Git; nunca coloque credenciais em `.env.example` ou em arquivos de catálogo. Um modelo preenchível e sem segredos está em [`.env.example`](.env.example).

## Acesso privado ao Google Drive

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto e ative a **Google Drive API**.
2. Em **Google Auth Platform**, configure a tela de permissão com público-alvo **Interno** (contas Google Workspace) e adicione o escopo `.../auth/drive.readonly`.
3. Em **Clientes**, crie um ID do cliente OAuth do tipo **App para computador** e copie o ID e a chave secreta para o `.env`.
4. Gere fora do app um refresh token para esse mesmo cliente, autorizando o escopo `https://www.googleapis.com/auth/drive.readonly`, e grave-o no `.env`.

Com isso, o catálogo, os vídeos e o APK de atualização podem ficar com acesso **Restrito** no Drive.

> O refresh token fica dentro do app instalado e dá acesso de leitura ao Drive da conta. Não distribua o APK. O acesso pode ser revogado em [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Executar no emulador

1. Crie no Android Studio um dispositivo virtual da categoria **TV**.
2. Abra o emulador sem o Android Studio (o script fecha emuladores abertos e inicia do zero):

   ```bash
   ./scripts/abrir-emulador.sh            # opções: --quick, --software-gpu, [nome do emulador]
   ```

3. Em dois terminais:

   ```bash
   npm start
   npm run android
   ```

No emulador, as setas funcionam como o D-pad, **Enter** como OK e **Esc** como Voltar.

## Catálogo

O app lê um único arquivo JSON, o `AppTV.catalago.json`, cuja cópia publicada fica no Google Drive. Esse arquivo é **gerado** a partir de arquivos pequenos na pasta local `catalogo/` (um por título), que são os que você edita. Tanto `catalogo/` quanto o catálogo gerado são ignorados pelo Git porque contêm a biblioteca particular. Não edite o `AppTV.catalago.json` à mão: ele é reescrito a cada geração.

O arquivo [catalog.example.json](catalog.example.json) é um catálogo publicado completo e copiável, com filme, série, múltiplas fontes, legenda externa e `live: false`. Os valores `ID_DO_*` e URLs de `example.com` são apenas marcadores.

### Como o catálogo é organizado

```text
catalogo/
  catalogo.json      Ordem dos itens no app (atualizada automaticamente)
  series/<id>.json   Uma série por arquivo, incluindo episódios sincronizados
  filmes/<id>.json   Um filme por arquivo
```

O nome do arquivo deve ser igual ao `id` do item. Um arquivo novo entra no fim do catálogo, e um arquivo apagado sai dele.

Uma série pode ser escrita de dois jeitos:

- **Com os episódios no próprio arquivo** (`seasons`), no formato mostrado abaixo.
- **Ligada a uma pasta do Drive** (recomendado para séries novas). Os episódios, links e durações são sincronizados para o próprio arquivo da série:

```json
{
  "id": "futurama",
  "type": "series",
  "title": "Futurama",
  "description": "Descrição da série.",
  "imdbId": "tt0149460",
  "genres": ["Animação", "Comédia"],
  "addedAt": "2026-11-12T00:00:00Z",
  "drive": {"folderId": "ID_DA_PASTA_DA_SERIE", "sourceName": "Dublado"},
  "episodios": {
    "s01e05": {"title": "Título corrigido"}
  }
}
```

A pasta da série no Drive deve ter uma subpasta por temporada (`1ª Temporada`, `Temporada 01`...) e, opcionalmente, `Especiais` (temporada 0). O número do episódio vem do nome do arquivo (`S01E05`, `Episódio 05- Título`, `Especial 01 - Título`), e o título também, quando existe. `episodios` serve para corrigir um episódio sem perder a correção na próxima sincronização. Se a série não tiver `poster`, ele é buscado no IMDb pelo `imdbId`. `drive`, `episodios` e `imdbId` não vão para o catálogo publicado.

### Comandos

| Comando | O que faz |
|---|---|
| `npm run catalogo:enviar` | Gera, valida e envia o `AppTV.catalago.json` para o Google Drive. |
| `node scripts/catalogo/gerar.js` | Gera e valida o catálogo local sem enviar. |
| `node scripts/catalogo/gerar.js --check` | Confere se o catálogo gerado está atualizado; retorna erro quando precisa ser regenerado. |
| `node scripts/catalogo/sincronizar-drive.js [id]` | Atualiza episódios das séries que possuem o bloco `drive`; sem ID, sincroniza todas. |
| `node scripts/catalogo/sincronizar-drive.js [id] --aceitar-remocoes` | Confirma uma sincronização que removeria episódios antes existentes. |
| `npm run catalogo:enviar -- --force` | Cria/substitui o arquivo remoto mesmo quando o ID esperado não coincide. Use deliberadamente. |

### Formato do catálogo gerado

O `AppTV.catalago.json` tem este formato (os arquivos de `catalogo/series` e `catalogo/filmes` são itens deste `items`):

```json
{
  "version": 1,
  "items": [
    {
      "id": "minha-serie",
      "type": "series",
      "title": "Minha Série",
      "description": "Descrição da série.",
      "poster": "https://exemplo.com/capa.jpg",
      "genres": ["Comédia"],
      "addedAt": "2026-10-26T00:00:00Z",
      "seasons": [
        {
          "number": 1,
          "name": "Temporada 1",
          "episodes": [
            {
              "id": "s01e01",
              "number": 1,
              "title": "Episódio 1",
              "duration": 1320,
              "sources": [
                {"id": "s01e01", "name": "Original", "url": "https://drive.google.com/file/d/ID_DO_ARQUIVO/view"}
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Regras principais:

- `version` deve ser `1`. Tamanho máximo de 5 MB e 10.000 itens.
- Filmes usam `"type": "movie"` e uma lista `sources`. Séries usam `"type": "series"` e `seasons`.
- IDs de itens são únicos no catálogo. Dentro de uma série, IDs de episódio e números de temporada e episódio não se repetem.
- URLs devem usar HTTPS. Links do Google Drive são reconhecidos automaticamente.
- `provider` pode ser `google-drive` ou `direct`. Ele é opcional porque o app também reconhece links do Drive pela URL.
- `duration` é em segundos. Só itens com `addedAt` aparecem em "Adicionados recentemente".
- `"live": false` em um filme ou série tira o item da programação do Ao vivo. Ele continua na biblioteca. Sem o campo, o item entra no Ao vivo.
- Use o mesmo `name` de fonte em todos os episódios (por exemplo "Dublado"), pois é por ele que o app mantém a versão escolhida.
- Uma fonte pode ter `language`, `quality`, `mimeType`, `detail` e `subtitles`. Cada legenda externa requer `title`, `language`, `type` (`srt`, `vtt` ou `ttml`) e `url`; `provider` é opcional.
- Áudios e legendas já embutidos no MP4/MKV não são cadastrados separadamente: o player os detecta no arquivo. A escolha de faixa aparece quando há opções, e legendas embutidas ou externas podem ser desligadas.
- No Ao vivo, o player seleciona preferencialmente uma faixa de áudio pt-BR/português e força as legendas desligadas. Isso não altera a escolha feita na reprodução normal.
- Um item inválido é ignorado sem impedir o carregamento do restante.

### Exemplo de arquivo-fonte de filme

Salve como `catalogo/filmes/filme-exemplo-2026.json`; o nome do arquivo deve coincidir com `id`:

```json
{
  "id": "filme-exemplo-2026",
  "type": "movie",
  "title": "Filme de exemplo",
  "year": 2026,
  "duration": 6120,
  "live": false,
  "sources": [
    {
      "id": "filme-exemplo-drive",
      "name": "Dual áudio",
      "provider": "google-drive",
      "url": "https://drive.google.com/file/d/ID_DO_VIDEO/view",
      "subtitles": [
        {
          "title": "Português (Brasil)",
          "language": "pt-BR",
          "type": "srt",
          "provider": "google-drive",
          "url": "https://drive.google.com/file/d/ID_DA_LEGENDA/view"
        }
      ]
    }
  ]
}
```

### Exemplo de arquivo-fonte de série ligada ao Drive

Salve como `catalogo/series/serie-exemplo.json`. `drive`, `imdbId` e `episodios` existem somente nos arquivos-fonte e são removidos do catálogo publicado:

```json
{
  "id": "serie-exemplo",
  "type": "series",
  "title": "Série de exemplo",
  "description": "Descrição da série.",
  "imdbId": "tt0000000",
  "genres": ["Comédia"],
  "addedAt": "2026-11-19T00:00:00Z",
  "drive": {
    "folderId": "ID_DA_PASTA_DA_SERIE",
    "sourceName": "Dublado"
  },
  "episodios": {
    "s01e01": {
      "title": "Título corrigido"
    }
  }
}
```

Para publicar o catálogo no Drive mantendo o mesmo link (o script gera o catálogo antes de enviar):

```bash
npm run catalogo:enviar
```

## Controle de versão e publicação

O app verifica o `AppTV.update.json` no Drive e oferece a nova versão pelo botão de versão no topo da biblioteca.

O projeto mantém dois números no `android/app/build.gradle`:

- `versionName`: versão visível, como `1.30`.
- `versionCode`: build inteiro exigido pelo Android; sempre aumenta em uma publicação.

`npm run apk:publicar` incrementa automaticamente o último número de `versionName` (`1.30` → `1.31`) e soma 1 ao `versionCode`. Para escolher uma versão específica, use `--version`. Depois que APK e manifesto são enviados com sucesso, o script também atualiza o bloco **Versão publicada** no topo deste README, incluindo versão, build e data. Uma publicação que falha não anuncia uma nova versão no README.

Para publicar uma nova versão:

```bash
npm run apk:publicar -- --notes "O que mudou" --version 1.2
```

O script aumenta `versionCode` e `versionName` no `android/app/build.gradle`, gera o APK de release, envia `AppTV.apk` e `AppTV.update.json` para a raiz do Drive (sempre substituindo os mesmos arquivos) e grava o `UPDATE_MANIFEST_URL` no `.env`. Se a compilação falhar, a versão anterior é restaurada.

Na primeira vez, rode o script uma vez e instale essa versão na TV com `npm run android`. As versões seguintes chegam pelo botão do app.

> Todas as versões são assinadas com `android/app/debug.keystore`. Trocar a chave de assinatura impede a atualização das versões já instaladas.

### Checklist de release

1. Execute `npm test` e `npm run typecheck`.
2. Publique com `npm run apk:publicar -- --notes "Resumo da versão"`.
3. Confirme que `AppTV.apk` e `AppTV.update.json` foram atualizados no Drive.
4. Revise as mudanças automáticas em `build.gradle`, `AppTV.update.json` e neste README.

## Scripts

| Comando | Descrição |
|---|---|
| `npm start` | Inicia o Metro |
| `npm run android` | Compila e instala no emulador ou dispositivo |
| `npm run android:release` | Gera `android/app/build/outputs/apk/release/app-release.apk` |
| `npm run apk:publicar` | Gera e publica uma nova versão do APK no Google Drive |
| `npm test` | Testes (Jest) |
| `npm run typecheck` | Verificação de tipos (TypeScript) |
| `npm run lint` | ESLint |
| `npm run catalogo:enviar` | Gera, valida e envia o catálogo para o Google Drive |
| `scripts/abrir-emulador` | Abre o emulador de TV sem o Android Studio |
| `scripts/catalogo/gerar.js` | Monta e valida o catálogo publicado a partir dos arquivos-fonte |
| `scripts/catalogo/sincronizar-drive.js` | Sincroniza temporadas e episódios de pastas do Drive |
| `scripts/catalogo/enviar.js` | Gera o catálogo e envia o `AppTV.catalago.json` para o Drive |
| `scripts/publicar-apk.js` | Implementa a geração e publicação de uma nova versão do app |

O emulador mantém lançadores para Windows e Git Bash. Os publicadores em JavaScript instalam e configuram o [rclone](https://rclone.org) no primeiro uso.

## Estrutura

```text
src/
  catalog/      Download, validação e resolução de links (Drive, API, links diretos)
  components/   Componentes com foco para TV (botões, cards, barra de progresso)
  context/      Estado global (catálogo, URL, erros)
  domain/       Modelos de catálogo e regras de progresso
  playback/     Filas sequencial e aleatória, retomada e parâmetros do player
  screens/      Biblioteca, Ao vivo, detalhes, reprodução, configuração, atualização e fonte
  services/     Login do Google, requisições ao Drive e atualização do APK
  storage/      SQLite (progresso, filas, preferências) e AsyncStorage
  utils/        Formatação de tempo, duração e tamanho
android/app/src/main/java/com/apptvclient/updater/   Módulo nativo de atualização
catalogo/       Fonte do catálogo: um arquivo por série ou filme
scripts/        Automação no PC (emulador, Drive, catálogo, publicação)
__tests__/      Testes de validação, filas, retomada e links
```

## Limitações conhecidas

- O Google bloqueia o acesso público a arquivos que identifica como protegidos por direitos autorais. Esses arquivos só funcionam com o login OAuth da conta dona.
- O Drive não foi feito para streaming. Para uso intenso, prefira um servidor próprio com links HTTPS diretos.
- O app é voltado a Android TV e não foi preparado para iOS.
