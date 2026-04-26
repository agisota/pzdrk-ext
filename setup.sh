#!/bin/bash

# Pzdrk v7.0 Setup Script
set -e

echo "🚀 Setting up Pzdrk v7.0 Advanced Architecture..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Install with: brew install node${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Install Docker Desktop first${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites met${NC}"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Create directories
echo ""
echo "📁 Creating directories..."
mkdir -p volumes/{etcd,minio,milvus}
mkdir -p logs

# Check if .env exists
if [ ! -f .env ]; then
    echo ""
    echo "⚠️  .env file not found. Creating template..."
    cat > .env << 'EOF'
# Pzdrk v7.0 Configuration

# API Keys (comma-separated for multiple keys)
GROQ_API_KEYS=your_groq_key_1,your_groq_key_2
CEREBRAS_API_KEYS=your_cerebras_key_1
OPENAI_API_KEY=your_openai_key

# Obsidian Vault
OBSIDIAN_VAULT_PATH=/Users/YOUR_USERNAME/Documents/Obsidian/Main
OBSIDIAN_NOTE_FOLDER=pzdrk-summaries

# Milvus (local)
MILVUS_HOST=localhost
MILVUS_PORT=19530

# Server
SERVER_PORT=7420
EOF
    echo -e "${YELLOW}⚠️  Please edit .env and add your API keys${NC}"
fi

# Start Milvus
echo ""
echo "🐳 Starting Milvus..."
docker-compose -f docker-compose.milvus.yml up -d

# Wait for Milvus to be ready
echo ""
echo "⏳ Waiting for Milvus to be ready..."
sleep 10

# Check Milvus health
if curl -s http://localhost:9091/healthz > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Milvus is running${NC}"
else
    echo -e "${YELLOW}⚠️  Milvus may still be starting. Check with: docker-compose -f docker-compose.milvus.yml logs -f${NC}"
fi

# Create startup scripts
echo ""
echo "📝 Creating startup scripts..."

cat > start-hub.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting Pzdrk Data Hub..."
npm run server
EOF
chmod +x start-hub.sh

cat > start-milvus.sh << 'EOF'
#!/bin/bash
echo "🐳 Starting Milvus..."
docker-compose -f docker-compose.milvus.yml up -d
echo "✅ Milvus started. GUI: http://localhost:8000"
EOF
chmod +x start-milvus.sh

cat > stop-milvus.sh << 'EOF'
#!/bin/bash
echo "🛑 Stopping Milvus..."
docker-compose -f docker-compose.milvus.yml down
echo "✅ Milvus stopped"
EOF
chmod +x stop-milvus.sh

cat > build-ext.sh << 'EOF'
#!/bin/bash
echo "🔨 Building extension..."
npm run build
echo "✅ Extension built. Load 'dist/' in Chrome"
EOF
chmod +x build-ext.sh

# Summary
echo ""
echo "========================================"
echo -e "${GREEN}✅ Setup complete!${NC}"
echo "========================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Edit .env and add your API keys:"
echo "   nano .env"
echo ""
echo "2. Start the data hub:"
echo "   ./start-hub.sh"
echo ""
echo "3. Build the extension:"
echo "   ./build-ext.sh"
echo ""
echo "4. Load extension in Chrome:"
echo "   - Open chrome://extensions"
echo "   - Enable Developer mode"
echo "   - Click 'Load unpacked'"
echo "   - Select the 'dist/' folder"
echo ""
echo "5. Open Milvus GUI:"
echo "   http://localhost:8000"
echo ""
echo "Available commands:"
echo "  ./start-hub.sh     - Start data hub server"
echo "  ./start-milvus.sh  - Start Milvus"
echo "  ./stop-milvus.sh   - Stop Milvus"
echo "  ./build-ext.sh     - Build extension"
echo ""
echo "Happy analyzing! 🎉"
