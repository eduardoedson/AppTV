# AppTV

Aplicativo para **Android TV / Google TV**, feito em React Native, que monta uma biblioteca de filmes e séries a partir de um catálogo JSON e reproduz os vídeos com navegação completa pelo controle remoto.

O catálogo e os vídeos podem ficar no **Google Drive, de forma privada**: o app acessa os arquivos com a sua conta Google por meio da API oficial do Drive.

## Funcionalidades

- Biblioteca com capas, progresso de cada título e seção de continuar assistindo.
- Tela de detalhes com temporadas, episódios, progresso por episódio e marcação do último visto.
- Botão único de reprodução: retoma o episódio pela metade ou segue a ordem escolhida.
- **Ordem sequencial ou aleatória** por série. No aleatório, nenhum episódio se repete até completar o ciclo, e é possível escolher temporadas inteiras ou episódios específicos em "Configurar reprodução".
- Avanço automático entre episódios. Se um episódio falhar, o app mostra o erro e pula para o próximo após 10 segundos (pausa depois de 5 falhas seguidas).
- Progresso salvo em SQLite, com retomada exata ao reabrir o app.
- Várias versões por título (por exemplo Dublado e Legendado), com a escolha lembrada por série.
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

## Requisitos

- Node.js 20 ou superior
- Android Studio com Android SDK 36, Platform Tools e Emulator
- Java 17 (já incluído no Android Studio)
- Variável `ANDROID_HOME` apontando para o SDK (`%LOCALAPPDATA%\Android\Sdk`) e as pastas `platform-tools` e `emulator` no `Path`

## Instalação

```bash
npm install --legacy-peer-deps
cp .env.example .env
```

Preencha o `.env` conforme a seção abaixo.

## Configuração (`.env`)

| Variável | Descrição |
|---|---|
| `DEFAULT_CATALOG_URL` | URL do catálogo carregado ao abrir o app. Aceita link do Google Drive ou qualquer URL HTTPS. |
| `GOOGLE_DRIVE_API_KEY` | Opcional. Chave de API para arquivos **públicos** do Drive. Ignorada quando o login OAuth está configurado. |
| `GOOGLE_OAUTH_CLIENT_ID` | ID do cliente OAuth do tipo "App para computador". |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Chave secreta do mesmo cliente OAuth. |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Preenchido automaticamente por `npm run google:login`. |
| `UPDATE_MANIFEST_URL` | Link do `AppTV.update.json` no Drive. Preenchido automaticamente por `scripts/publicar-apk`. |

Depois de alterar o `.env`, reinicie o Metro limpando o cache: `npm start -- --reset-cache`.

## Acesso privado ao Google Drive

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto e ative a **Google Drive API**.
2. Em **Google Auth Platform**, configure a tela de permissão com público-alvo **Interno** (contas Google Workspace) e adicione o escopo `.../auth/drive.readonly`.
3. Em **Clientes**, crie um ID do cliente OAuth do tipo **App para computador** e copie o ID e a chave secreta para o `.env`.
4. Rode o login uma única vez no PC:

   ```bash
   npm run google:login
   ```

   O navegador abre para você entrar com a conta dona dos arquivos. O refresh token é gravado no `.env`.

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

Um único arquivo JSON descreve toda a biblioteca. O catálogo atual é o `AppTV.catalago.json` na raiz do projeto, cuja cópia publicada fica no Google Drive. Ele não é versionado no Git: use o `catalog.example.json` como modelo.

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
- `duration` é em segundos. Só itens com `addedAt` aparecem em "Adicionados recentemente".
- Use o mesmo `name` de fonte em todos os episódios (por exemplo "Dublado"), pois é por ele que o app mantém a versão escolhida.
- Um item inválido é ignorado sem impedir o carregamento do restante.

Para publicar o catálogo no Drive mantendo o mesmo link:

```bash
./scripts/enviar-catalogo.sh
```

## Atualizações do app

O app verifica o `AppTV.update.json` no Drive e oferece a nova versão pelo botão de versão no topo da biblioteca.

Para publicar uma nova versão:

```bash
./scripts/publicar-apk.sh --notes "O que mudou" [--version 1.2]
```

O script aumenta `versionCode` e `versionName` no `android/app/build.gradle`, gera o APK de release, envia `AppTV.apk` e `AppTV.update.json` para a raiz do Drive (sempre substituindo os mesmos arquivos) e grava o `UPDATE_MANIFEST_URL` no `.env`. Se a compilação falhar, a versão anterior é restaurada.

Na primeira vez, rode o script uma vez e instale essa versão na TV com `npm run android`. As versões seguintes chegam pelo botão do app.

> Todas as versões são assinadas com `android/app/debug.keystore`. Trocar a chave de assinatura impede a atualização das versões já instaladas.

## Scripts

| Comando | Descrição |
|---|---|
| `npm start` | Inicia o Metro |
| `npm run android` | Compila e instala no emulador ou dispositivo |
| `npm run android:release` | Gera o APK de release |
| `npm run google:login` | Faz o login no Google e grava o refresh token no `.env` |
| `npm test` | Testes (Jest) |
| `npm run typecheck` | Verificação de tipos (TypeScript) |
| `npm run lint` | ESLint |
| `scripts/abrir-emulador` | Abre o emulador de TV sem o Android Studio |
| `scripts/enviar-catalogo` | Envia o `AppTV.catalago.json` para o Drive |
| `scripts/publicar-apk` | Gera e publica uma nova versão do app |

Os scripts têm versões `.sh` (Git Bash), `.bat` (duplo clique) e `.ps1` (PowerShell). Os que usam o Drive instalam e configuram o [rclone](https://rclone.org) na primeira execução.

## Estrutura

```text
src/
  catalog/      Download, validação e resolução de links (Drive, API, links diretos)
  components/   Componentes com foco para TV (botões, cards, barra de progresso)
  context/      Estado global (catálogo, URL, erros)
  domain/       Modelos de catálogo e regras de progresso
  playback/     Filas sequencial e aleatória, retomada e parâmetros do player
  screens/      Biblioteca, detalhes, configuração da reprodução, player, atualização e fonte
  services/     Login do Google, requisições ao Drive e atualização do APK
  storage/      SQLite (progresso, filas, preferências) e AsyncStorage
  utils/        Formatação de tempo, duração e tamanho
android/app/src/main/java/com/apptvclient/updater/   Módulo nativo de atualização
scripts/        Automação no PC (emulador, Drive, publicação)
__tests__/      Testes de validação, filas, retomada e links
```

## Limitações conhecidas

- O Google bloqueia o acesso público a arquivos que identifica como protegidos por direitos autorais. Esses arquivos só funcionam com o login OAuth da conta dona.
- O Drive não foi feito para streaming. Para uso intenso, prefira um servidor próprio com links HTTPS diretos.
- O app é voltado a Android TV e não foi preparado para iOS.
