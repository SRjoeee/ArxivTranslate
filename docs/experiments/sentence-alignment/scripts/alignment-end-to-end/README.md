# The alignment path, end to end

Every hop has unit tests — Microsoft reads `sentLen` (#125), the service verifies it and the queue
carries it (#128), the cache persists it (#129) — but nothing had checked the whole chain on a real
page. This loads the built extension, selects Microsoft, translates a real paper and reads the
extension's IndexedDB to see what actually landed.

```
node run.mjs <path to .output/chrome-mv3>
```

Result on 2609.04056v1 with main at 0f7df17:

```
edge.microsoft.com          5 requests
session idle                26/26 requested, 0 failed
response carries sentLen    { srcSentLen: [86], transSentLen: [26] }
cache entries               39
entries with alignment      39
target lengths sum to the translation's length, so verifyAlignment passed
```

**The first run reported zero entries with alignment, and it was the probe's fault.** The options
page needs its 保存 button clicked before the change reaches storage; without it the run used the
default `openai-compat`, found no API key and fell back to Google, so Microsoft never ran. The
console said so — `OpenAI 兼容端点 降级（no-key）` — which is why the logs are captured here.
