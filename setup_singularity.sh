#!/bin/bash
# Setup script for Singularity Loop Architecture

set -e

echo "🚀 Setting up Singularity Loop Architecture..."

# Create memory directory structure
echo "📁 Creating memory store..."
mkdir -p output/memory/context_snapshots

# Initialize memory files
echo "📝 Initializing memory files..."

# session_log.jsonl (empty, append-only)
touch output/memory/session_log.jsonl

# lessons_learned.json
cat > output/memory/lessons_learned.json << 'EOF'
{
  "task_prioritization": [],
  "error_handling": [],
  "performance_optimization": [],
  "architectural_decisions": []
}
EOF

# agent_performance.json
cat > output/memory/agent_performance.json << 'EOF'
{
  "last_updated": null,
  "metrics": {
    "iterations": [],
    "agent_executions": []
  }
}
EOF

# quickwin_history.json
cat > output/memory/quickwin_history.json << 'EOF'
[]
EOF

# rules.json
cat > output/memory/rules.json << 'EOF'
[]
EOF

# Install Python dependencies
echo "📦 Installing Python dependencies..."
if command -v pip3 &> /dev/null; then
    pip3 install psutil
else
    echo "⚠️  pip3 not found. Please install psutil manually: pip install psutil"
fi

# Make scripts executable
echo "🔧 Making scripts executable..."
chmod +x singularity_loop.py
chmod +x quickwin_detector.py
chmod +x memory_manager.py
chmod +x agent_monitor.py

echo ""
echo "✅ Singularity Loop setup complete!"
echo ""
echo "📚 Next steps:"
echo "  1. Review the architecture: cat SINGULARITY_ARCHITECTURE.md"
echo "  2. Run single iteration: ./singularity_loop.py --once"
echo "  3. Run continuous loop: ./singularity_loop.py --iterations 10"
echo ""
echo "🎯 Memory store location: output/memory/"
echo ""
