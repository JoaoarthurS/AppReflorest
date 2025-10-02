# 📍 GPS Polygon Mapper

**Aplicativo móvel que coleta coordenadas GPS via botão e cria polígonos para exportação em KML, funcionando totalmente offline.**

## 🎯 Funcionalidades Principais

### Tela Inicial do App:
- ✅ Mapa em tela cheia mostrando localização atual
- ✅ Botão flutuante grande "CAPTURAR PONTO" (cor destacada)
- ✅ Barra inferior com:
  - Botão "DESFAZER" último ponto
  - Contador de pontos: "X pontos capturados"
  - Botão "FINALIZAR POLÍGONO"
  - Botão "EXPORTAR KML"
- ✅ Menu hambúrguer para configurações

### Captura de Localização:
- ✅ Ao tocar em "CAPTURAR PONTO":
  - Aciona GPS para pegar localização atual
  - Mostra loading enquanto busca coordenadas
  - Vibração e som de confirmação
  - Marca ponto no mapa com número sequencial
  - Adiciona à lista de coordenadas

### Formação do Polígono:
- ✅ Pontos conectados automaticamente por linhas
- ✅ Visualização em tempo real do polígono se formando
- ✅ Opção de desfazer último ponto
- ✅ Polígono fecha automaticamente ao finalizar

### Armazenamento Offline:
- ✅ Dados salvos localmente no celular
- ✅ Histórico de polígonos criados
- ✅ Funciona sem internet 100% do tempo

### Exportação KML:
- ✅ Gera arquivo KML com todos os pontos
- ✅ Salva na pasta "Downloads" do celular
- ✅ Opção de compartilhar via WhatsApp, email, etc.
- ✅ Abre em apps como Google Earth, Maps

## 🚀 Fluxo do Usuário

1. **Abre o app** → Mapa mostra localização atual
2. **Move até o local desejado** → Clica "CAPTURAR PONTO"
3. **Repete para cada ponto** do polígono
4. **Clica "FINALIZAR POLÍGONO"** → Digite um nome
5. **Clica "EXPORTAR KML"** → Salva/compartilha arquivo

## 🛠️ Tecnologias e Recursos

```json
{
  "framework": "React Native + Expo",
  "mapa": "react-native-maps",
  "gps": "expo-location", 
  "armazenamento": "@react-native-async-storage/async-storage",
  "arquivos": "expo-file-system",
  "compartilhamento": "expo-sharing",
  "vibração": "expo-haptics"
}
```

## ⚙️ Parâmetros GPS

- **Precisão**: Alta precisão (5-10 metros)
- **Timeout**: 15 segundos
- **Atualização**: Somente sob demanda (botão)

## 📦 Instalação e Configuração

### Pré-requisitos
- Node.js (versão 18 ou superior)
- npm ou yarn
- Expo CLI (`npm install -g @expo/cli`)
- Dispositivo móvel com Expo Go ou emulador

### Passos de Instalação

1. **Clone o repositório:**
   ```bash
   git clone <url-do-repositorio>
   cd gps-polygon-mapper
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Inicie o servidor de desenvolvimento:**
   ```bash
   npx expo start
   ```

4. **Execute no dispositivo:**
   - **Android**: Pressione `a` no terminal ou escaneie o QR code com o Expo Go
   - **iOS**: Pressione `i` no terminal ou escaneie o QR code com a câmera
   - **Web**: Pressione `w` no terminal (funcionalidade limitada no web)

## 📱 Build para Produção

### Para Android (APK):
```bash
npx expo build:android
```

### Para iOS (IPA):
```bash
npx expo build:ios
```

### Para App Store/Google Play:
```bash
npx expo submit
```

## 🔧 Configurações Importantes

### Permissões (Android):
- `ACCESS_FINE_LOCATION` - Localização precisa
- `ACCESS_COARSE_LOCATION` - Localização aproximada
- `WRITE_EXTERNAL_STORAGE` - Salvar arquivos
- `READ_EXTERNAL_STORAGE` - Ler arquivos

### Permissões (iOS):
- `NSLocationWhenInUseUsageDescription` - Localização durante uso
- `NSLocationAlwaysAndWhenInUseUsageDescription` - Localização sempre

## 📂 Estrutura do Projeto

```
app/
├── (tabs)/
│   ├── index.tsx          # Tela principal com mapa
│   ├── explore.tsx        # Histórico de polígonos
│   └── _layout.tsx        # Layout das abas
├── _layout.tsx           # Layout raiz
└── modal.tsx            # Modal (não usado)

components/               # Componentes reutilizáveis
constants/               # Constantes e temas
hooks/                  # Hooks customizados
assets/                 # Imagens e recursos
```

## 🎨 Interface do Usuário

### Tela Principal:
- **Mapa**: Visualização em tela cheia
- **Botão Capturar**: Circular, laranja, no centro inferior
- **Barra Inferior**: Preta transparente com 4 botões
- **Menu**: Hambúrguer no canto superior esquerdo

### Tela Histórico:
- **Lista**: Cards com informações dos polígonos
- **Ações**: Visualizar coordenadas e excluir
- **Refresh**: Puxar para atualizar

## 🐛 Troubleshooting

### Problema com GPS:
- Verifique se a localização está habilitada no dispositivo
- Teste em área aberta (não funciona bem em ambientes fechados)
- Aguarde até 15 segundos para primeira captura

### Problema com Mapas:
- Certifique-se de ter uma chave da Google Maps (se necessário)
- Verifique a conexão de internet na primeira inicialização

### Problema com Exportação:
- Verifique as permissões de armazenamento
- Teste o compartilhamento com diferentes apps

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📞 Suporte

Para suporte e dúvidas:
- Abra uma issue no GitHub
- Entre em contato via email

---

**Desenvolvido com ❤️ usando React Native + Expo**
