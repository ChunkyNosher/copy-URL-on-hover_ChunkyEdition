# Agentic-Tools MCP Memory Search Fix

**Date:** November 24, 2025  
**Issue:** Memory search functionality broken with `Cannot read properties of undefined (reading 'toLowerCase')`  
**Status:** ✅ RESOLVED

## Problem Statement

The agentic-tools MCP `search_memories` function was failing with:
```
Error searching memories: Cannot read properties of undefined (reading 'toLowerCase')
```

This prevented searching through the 104 stored memories, blocking access to critical architectural decisions, testing strategies, and implementation details related to Issue #47 and Quick Tabs synchronization.

## Root Cause Analysis

### Investigation Process

1. **Initial Testing**: Attempted to search for "issue #47" and "Quick Tabs sync" - both failed
2. **list_memories Verification**: Confirmed 104 memories exist and list function works
3. **Schema Inspection**: Examined memory JSON files to understand expected structure
4. **Perplexity Research**: Found GitHub issue #2044 documenting identical error in MCP memory servers
5. **Validation Scan**: Used jq to check all 104 memory files for schema compliance

### Root Cause

Memory file `.agentic-tools-mcp/memories/architecture/Gap_7_Structured_Logging_Complete.json` used the field name `content` instead of `details`. 

**Expected Schema:**
```json
{
  "id": "...",
  "title": "...",
  "details": "...",    // ✅ CORRECT
  "category": "...",
  "dateCreated": "...",
  "dateUpdated": "..."
}
```

**Problematic Schema:**
```json
{
  "id": "...",
  "title": "...",
  "content": "...",    // ❌ WRONG - causes search to fail
  "category": "..."
}
```

When the search function iterated through memories and tried to search the `details` field, it encountered `undefined` and crashed when calling `.toLowerCase()` on it.

## Solution Implemented

### 1. Schema Fix

Used jq to rename the field:
```bash
jq '.details = .content | del(.content)' Gap_7_Structured_Logging_Complete.json > fixed.json
mv fixed.json Gap_7_Structured_Logging_Complete.json
```

### 2. Documentation Update

Added "Memory Schema Validation" section to `.github/copilot-instructions.md` including:
- Required field list with types
- Common error explanation
- Validation commands
- Clarification about create_memory parameter naming (uses `content` parameter but stores as `details`)

### 3. Troubleshooting Memory

Created memory documenting:
- Root cause
- Fix procedure
- Validation commands
- Prevention guidance

## Verification Results

### Test Suite - All Passing ✅

| Test | Query | Results | Status |
|------|-------|---------|--------|
| Issue #47 Search | "issue #47" | 10 memories | ✅ PASS |
| Quick Tabs Search | "Quick Tabs sync" | 3 memories | ✅ PASS |
| Architecture Filter | "sync" + category:"architecture" | 10 memories | ✅ PASS |
| Pattern Search | "architecture pattern" | 3 memories | ✅ PASS |
| Memory Retrieval | ID: c2baed27-3d42-4b53-9da8-41af42b15a69 | Full content | ✅ PASS |

### Sample Search Results

**Query: "issue #47"** (10 results, top 3 shown)
1. Integration test scenarios implementation (100% relevance)
2. Phase 1 completion (100% relevance)
3. Manual testing procedure (100% relevance)

**Query: "Quick Tabs sync"** (3 results)
1. Scenario 2: Multiple Quick Tabs sync (26.6% relevance)
2. Issue #47 Scenario 2 (24.1% relevance)
3. Playwright MCP setup (13.9% relevance)

**Query: "sync" with category:"architecture"** (10 results, top 3 shown)
1. Console Filter Async/Sync Issue (100% relevance)
2. Quick Tab Cross-Tab Sync Architecture Pattern (95.1% relevance)
3. Cross-Domain Sync Improvements (87.9% relevance)

## Key Findings

### Architecture Insights Retrieved

Successfully retrieved the critical "Quick Tab Cross-Tab Sync Architecture Pattern" memory showing:

**Three-Layer Synchronization System:**
1. **Layer 1: Real-time BroadcastChannel** - Fast <10ms cross-tab notifications
2. **Layer 2: Persistent browser.storage.local** - Reliable state persistence
3. **Layer 3: Tab Visibility Refresh** - UI sync when tab becomes visible

### Issue #47 Context

Found extensive documentation on:
- 11 integration test scenarios implemented (83 tests)
- Manual testing procedures
- Test Bridge API for autonomous testing
- Cross-tab synchronization protocol testing approach

## Prevention Measures

### Validation Commands Added

```bash
# Check for missing required fields
find .agentic-tools-mcp/memories -name "*.json" -exec sh -c \
  'jq -e ".title and .details and .category" "$1" > /dev/null || \
   echo "Missing fields: $1"' _ {} \;

# Check for incorrect 'content' field
find .agentic-tools-mcp/memories -name "*.json" -exec sh -c \
  'jq -e ".content" "$1" > /dev/null 2>&1 && \
   echo "Wrong schema: $1"' _ {} \;
```

### Documentation Standards

Updated Copilot instructions to clarify:
- The `create_memory` tool parameter is named `content` but stores as `details` in JSON
- Manual memory file creation should use `details` field
- Schema validation should be run before committing memory files

## Files Modified

1. `.agentic-tools-mcp/memories/architecture/Gap_7_Structured_Logging_Complete.json` - Fixed schema
2. `.github/copilot-instructions.md` - Added validation section (+643 bytes, 24,957 bytes total)
3. `.agentic-tools-mcp/memories/troubleshooting/Agentic-Tools_MCP_Search_Bug_Fix.json` - New memory

## Impact

- ✅ All 104 memories now searchable
- ✅ Issue #47 context accessible (10 memories)
- ✅ Quick Tabs synchronization architecture documented
- ✅ Future schema errors preventable through validation
- ✅ Copilot agents can now search memories before implementing features

## References

- GitHub Issue: https://github.com/modelcontextprotocol/servers/issues/2044
- Agentic-Tools MCP: https://github.com/Pimzino/agentic-tools-mcp
- PR Branch: copilot/fix-agentic-tools-setup-again
