import{s as m,k as a}from"./smart-router-JDkFv81c.js";import{S as i}from"./index-C2liYqEQ.js";async function u(){const{apiKeys:e}=await chrome.storage.sync.get("apiKeys");e?.groq&&a.registerKeys("groq",e.groq),e?.cerebras&&a.registerKeys("cerebras",e.cerebras),e?.openai&&a.registerKeys("openai",e.openai)}async function y(e,o){const s={id:`summary-${Date.now()}`,prompt:`Analyze this page and provide a comprehensive summary in Russian.
    
URL: ${e}

Content:
${o.slice(0,12e3)}

Provide output as JSON with fields:
- core: main point (2-3 sentences)
- keyPoints: array of key insights
- til: array of "today I learned" facts
- actions: array of actionable items
- entities: array of named entities
- terms: array of {term, definition}`,systemPrompt:`${i.mondayPersona}

${i.jsonValidator}`,estimatedInputTokens:Math.ceil(o.length/4),estimatedOutputTokens:1500,requiresJson:!0,requiresStreaming:!1,complexity:"complex",latencySlo:5e3,retryCount:0},n=await m.execute(s,{strategy:"race",timeoutMs:8e3,maxRetries:2});let t;try{const r=n.content.match(/\{[\s\S]*\}/);t=JSON.parse(r?r[0]:n.content)}catch{t={core:n.content.slice(0,500),keyPoints:[],til:[],actions:[],entities:[],terms:[]}}return{id:`summary-${Date.now()}`,url:e,title:document.title,timestamp:Date.now(),domain:new URL(e).hostname,depth:3,tags:[],tokenCount:n.inputTokens+n.outputTokens,summary:{core:t.core||"",keyPoints:t.keyPoints||[],til:t.til||[],actions:t.actions||[],entities:t.entities||[],terms:t.terms||[]},rawContent:o}}async function c(){await u(),m.registerProvider({id:"groq",name:"Groq",keys:[],models:[{id:"groq/compound",provider:"groq",maxTokens:8192,supportsJson:!0,supportsStreaming:!0,costPer1kInput:15e-5,costPer1kOutput:6e-4,avgLatencyMs:650}],baseUrl:"https://api.groq.com/openai/v1",rateLimits:{requestsPerMinute:30,tokensPerMinute:6e3},priority:1,healthStatus:"healthy"}),chrome.runtime.onMessage.addListener((e,o,s)=>{if(e.action==="summarize"){const n=l();return y(location.href,n).then(t=>{d(t),s({success:!0,data:t})}).catch(t=>{s({success:!1,error:t.message})}),!0}})}function l(){const e=["article","main",'[role="main"]',".post-content",".entry-content"];let o=null;for(const n of e)if(o=document.querySelector(n),o)break;o||(o=document.body);const s=o.cloneNode(!0);return s.querySelectorAll("script, style, nav, footer, header, aside, .ad").forEach(n=>n.remove()),(s.textContent||"").replace(/\s+/g," ").trim().slice(0,25e3)}async function d(e){try{await fetch("http://localhost:7420/api/summaries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)})}catch(o){console.error("Failed to sync to hub:",o)}}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",c):c();
