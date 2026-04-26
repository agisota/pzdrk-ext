#!/usr/bin/env python3
"""
Demo script for Singularity Loop Architecture

Demonstrates:
1. Loading existing task database
2. Detecting quickwins
3. Running single iteration
4. Viewing memory/metrics
"""

import json
from pathlib import Path
from singularity_loop import SingularityLoop
from quickwin_detector import QuickWinDetector
from memory_manager import MemoryManager
from agent_monitor import AgentMonitor


def print_section(title: str):
    """Print section header"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")


def demo_quickwin_detection():
    """Demo quickwin detection with sample tasks"""
    print_section("QuickWin Detection Demo")
    
    # Create sample tasks based on actual project
    sample_tasks = {
        "metadata": {
            "total_tasks": 156,
            "high_priority": 12,
            "quick_wins": 8
        },
        "tasks": [
            {
                "id": "VB-023",
                "title": "Popup interface",
                "estimated_hours": 3.0,
                "priority": "HIGH",
                "status": "not_started",
                "tags": ["user-facing", "quick-win"],
                "unblocks": ["VB-024", "VB-025"],
                "created_at": "2025-02-01T00:00:00Z"
            },
            {
                "id": "VA-014",
                "title": "Prompt variable validator",
                "estimated_hours": 3.0,
                "priority": "MEDIUM",
                "status": "not_started",
                "tags": ["user-facing", "validation"],
                "unblocks": ["VA-015"],
                "created_at": "2025-02-05T00:00:00Z"
            },
            {
                "id": "VA-056",
                "title": "Remove legacy floating notes",
                "estimated_hours": 2.0,
                "priority": "LOW",
                "status": "not_started",
                "tags": ["cleanup", "refactor"],
                "unblocks": [],
                "created_at": "2025-01-15T00:00:00Z"
            },
            {
                "id": "VB-020",
                "title": "Glassmorphism styles",
                "estimated_hours": 4.0,
                "priority": "MEDIUM",
                "status": "not_started",
                "tags": ["user-facing", "polish"],
                "unblocks": ["VB-021"],
                "created_at": "2025-02-08T00:00:00Z"
            },
            {
                "id": "VB-034",
                "title": "Smart Router unit tests",
                "estimated_hours": 4.0,
                "priority": "HIGH",
                "status": "not_started",
                "tags": ["testing", "quality"],
                "unblocks": ["VB-035", "VB-036"],
                "created_at": "2025-02-10T00:00:00Z"
            },
            {
                "id": "VB-016",
                "title": "Port note system from content.js",
                "estimated_hours": 8.0,
                "priority": "CRITICAL",
                "status": "not_started",
                "tags": ["user-facing", "core"],
                "unblocks": ["VB-017", "VB-018"],
                "created_at": "2025-02-01T00:00:00Z"
            }
        ]
    }
    
    # Initialize detector
    memory = MemoryManager(Path("output/memory"))
    detector = QuickWinDetector(memory)
    
    # Detect quickwins
    quickwins = []
    for task in sample_tasks["tasks"]:
        score = detector._score_task(task)
        
        if score.total_score >= detector.QUICKWIN_THRESHOLD and score.effort <= detector.MAX_EFFORT_HOURS:
            quickwins.append({
                "task_id": score.task_id,
                "title": task["title"],
                "score": score.total_score,
                "estimated_hours": score.estimated_hours,
                "reason": score.reason,
                "breakdown": {
                    "effort": f"{score.effort:.2f}",
                    "impact": f"{score.impact:.2f}",
                    "momentum": f"{score.momentum:.2f}",
                    "energy": f"{score.energy:.2f}"
                }
            })
    
    # Sort by score
    quickwins.sort(key=lambda x: x["score"], reverse=True)
    
    print(f"Found {len(quickwins)} quickwin candidates:\n")
    
    for i, qw in enumerate(quickwins, 1):
        print(f"{i}. {qw['task_id']}: {qw['title']}")
        print(f"   Score: {qw['score']:.2f} | Hours: {qw['estimated_hours']}")
        print(f"   Reason: {qw['reason']}")
        print(f"   Breakdown: Impact={qw['breakdown']['impact']}, "
              f"Momentum={qw['breakdown']['momentum']}, "
              f"Energy={qw['breakdown']['energy']}")
        print()


def demo_memory_system():
    """Demo memory management"""
    print_section("Memory System Demo")
    
    memory = MemoryManager(Path("output/memory"))
    memory.initialize()
    
    # Add sample lessons
    print("Adding sample lessons...")
    memory.add_lesson(
        category="task_prioritization",
        lesson="Always resolve blockers before starting new work",
        context={"iteration": 1}
    )
    
    memory.add_lesson(
        category="error_handling",
        lesson="Network errors should retry with exponential backoff",
        context={"error_type": "network"}
    )
    
    # Add sample rule
    print("Adding sample rule...")
    memory.add_rule(
        rule="If error_rate > 0.2, reduce parallelism",
        condition="error_rate > 0.2",
        action="reduce_parallelism",
        confidence=0.85
    )
    
    # Get statistics
    stats = memory.get_statistics()
    print(f"\nMemory Statistics:")
    print(f"  Total Lessons: {stats['total_lessons']}")
    print(f"  Lesson Categories: {stats['lesson_categories']}")
    print(f"  Total Rules: {stats['total_rules']}")
    print(f"  Active Rules: {stats['active_rules']}")
    print(f"  Current Session: {stats['current_session']}")
    
    # Get recent insights
    insights = memory.get_recent_insights(limit=3)
    print(f"\nRecent Insights:")
    for i, insight in enumerate(insights, 1):
        print(f"  {i}. {insight}")
    
    memory.save_state()


def demo_agent_monitor():
    """Demo agent monitoring"""
    print_section("Agent Monitor Demo")
    
    memory = MemoryManager(Path("output/memory"))
    monitor = AgentMonitor(memory)
    
    # Record sample executions
    print("Recording sample agent executions...")
    monitor.record_agent_execution("task_executor", success=True, duration_ms=1234.5)
    monitor.record_agent_execution("task_executor", success=True, duration_ms=987.3)
    monitor.record_agent_execution("quickwin_detector", success=True, duration_ms=456.2)
    monitor.record_agent_execution("task_executor", success=False, duration_ms=2345.6, error="timeout")
    
    # Get system health
    health = monitor.get_system_health()
    print(f"\nSystem Health: {health['status'].upper()}")
    print(f"  CPU: {health['system']['cpu_percent']:.1f}%")
    print(f"  Memory: {health['system']['memory_percent']:.1f}%")
    print(f"  Disk: {health['system']['disk_percent']:.1f}%")
    
    if health['issues']:
        print(f"\n  Issues:")
        for issue in health['issues']:
            print(f"    ⚠️  {issue}")
    
    # Get agent stats
    print(f"\nAgent Statistics:")
    print(f"  Total Executions: {health['agents']['total_executions']}")
    print(f"  Success Rate: {health['agents']['success_rate']:.1%}")
    print(f"  Avg Duration: {health['agents']['avg_duration_ms']:.1f}ms")
    
    # Get leaderboard
    leaderboard = monitor.get_agent_leaderboard(limit=5)
    if leaderboard:
        print(f"\nAgent Leaderboard:")
        for i, agent in enumerate(leaderboard, 1):
            print(f"  {i}. {agent['agent']}: {agent['success_rate']:.1%} "
                  f"({agent['total_executions']} runs, {agent['avg_duration_ms']:.1f}ms avg)")


def demo_full_iteration():
    """Demo full singularity loop iteration"""
    print_section("Full Iteration Demo")
    
    # Check if unified_tasks.json exists
    tasks_file = Path("output/unified_tasks.json")
    if not tasks_file.exists():
        print("⚠️  unified_tasks.json not found. Creating minimal version...")
        
        minimal_tasks = {
            "metadata": {
                "generated_at": "2025-02-12T10:30:00Z",
                "total_tasks": 156,
                "high_priority": 12,
                "quick_wins": 8,
                "completed": 15
            },
            "critical_decisions": [
                {
                    "id": "DECISION-001",
                    "title": "Choose v7.0 Architecture Track",
                    "priority": "CRITICAL",
                    "status": "pending",
                    "description": "Two incompatible architectures exist"
                }
            ]
        }
        
        with open(tasks_file, "w") as f:
            json.dump(minimal_tasks, f, indent=2)
        
        print("✅ Created minimal task database")
    
    # Initialize and run
    print("\nInitializing Singularity Loop...")
    loop = SingularityLoop()
    loop.initialize()
    
    print("\nRunning single iteration...")
    result = loop.run_iteration()
    
    print(f"\nIteration Results:")
    print(f"  Iteration: {result['iteration']}")
    print(f"  Success: {result['success']}")
    print(f"  Decisions Made: {result['decisions_made']}")
    print(f"  Tasks Executed: {result['tasks_executed']}")
    print(f"  Insights Learned: {result['insights_learned']}")
    
    # Show context snapshot
    snapshot_file = Path(f"output/memory/context_snapshots/iteration_{result['iteration']:04d}.json")
    if snapshot_file.exists():
        with open(snapshot_file) as f:
            context = json.load(f)
        
        print(f"\nContext Snapshot:")
        print(f"  Tasks Available: {context['tasks_available']}")
        print(f"  Tasks Completed: {context['tasks_completed']}")
        print(f"  Blockers: {len(context['blockers'])}")
        print(f"  QuickWin Candidates: {len(context['quickwin_candidates'])}")


def main():
    """Run all demos"""
    print("\n" + "="*60)
    print("  SINGULARITY LOOP ARCHITECTURE — DEMO")
    print("="*60)
    
    try:
        # Demo 1: QuickWin Detection
        demo_quickwin_detection()
        
        # Demo 2: Memory System
        demo_memory_system()
        
        # Demo 3: Agent Monitor
        demo_agent_monitor()
        
        # Demo 4: Full Iteration
        demo_full_iteration()
        
        print_section("Demo Complete")
        print("✅ All demos completed successfully!")
        print("\nNext steps:")
        print("  1. Review generated files in output/memory/")
        print("  2. Run: ./singularity_loop.py --once")
        print("  3. Read: SINGULARITY_ARCHITECTURE.md")
        print()
        
    except Exception as e:
        print(f"\n❌ Demo failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
