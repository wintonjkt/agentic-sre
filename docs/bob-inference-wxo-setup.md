# Bob Inference — watsonx Orchestrate (WXO) Setup & Log Guide

## Overview

`bob-inference` is the model gateway service that proxies all LLM calls from IBM Bob to
**watsonx Orchestrate (WXO)** on IBM Cloud. It runs in the `ibm-bob` namespace on
OpenShift, exposes an OpenAI-compatible API, and routes requests through the embedded
**Bifrost gateway** to the WXO model endpoint.

---

## Architecture

```
Bob Client (bob-shell / bob-admin)
        │
        │  POST /v1/chat/completions
        ▼
bob-inference (ClusterIP: 172.30.45.161)
  Port 7330 — TLS (external)
  Port 7331 — internal (no TLS)
        │
        │  OpenAI-compatible HTTP
        ▼
WXO Endpoint: https://us-south.ml.cloud.ibm.com/ml/gateway/v1
  Model: meta-llama/llama-3-3-70b-instruct
```

---

## Configuration

### ConfigMap: `bob-inference-config`

Mounted at `/src/config.yaml` inside the pod. Defines the models and routing strategy.

**File: `bob-inference-config` → `config.yaml`**

```yaml
models:
  - model_name: premium-ide       # Default model alias
    model_info:
      id: meta-llama/llama-3-3-70b-instruct
      family: gpt-oss
      mode: chat
      provider: openai
      max_input_tokens: 12000
      max_output_tokens: 4096
      exposed: true
    openai_compatible:
      base_url: https://us-south.ml.cloud.ibm.com/ml/gateway/v1
      model: meta-llama/llama-3-3-70b-instruct
      api_key: env.WXO_API_KEY     # Resolved from the bob-inference-secret

  - model_name: security           # Alias for security-focused tasks
    # (same model and endpoint as premium-ide)

  - model_name: background         # Alias for background tasks
    # (same model and endpoint as premium-ide)

routers:
  - name: router
    strategy: static
    static:
      default_model: premium-ide
```

All three model aliases (`premium-ide`, `security`, `background`) point to the same
upstream model and WXO endpoint. The router uses a **static** strategy with
`premium-ide` as the default.

### Secret: `bob-inference-secret`

Holds the API keys injected as environment variables into the container.

| Key | Purpose |
|-----|---------|
| `WXO_API_KEY` | API key for authenticating to `us-south.ml.cloud.ibm.com` |
| `GROQ_API_KEY` | Groq API key (secondary provider) |

The secret is projected into `/mnt/secrets/` alongside the TLS certificates from
`bob-internal-tls`.

To update the WXO API key:

```bash
# Decode the current key (for reference)
oc get secret bob-inference-secret -n ibm-bob \
  -o jsonpath='{.data.WXO_API_KEY}' | base64 -d

# Patch with a new key
oc patch secret bob-inference-secret -n ibm-bob \
  --type='json' \
  -p='[{"op":"replace","path":"/data/WXO_API_KEY","value":"'$(echo -n "<new-key>" | base64)'"}]'

# Restart the pod to pick up the change
oc rollout restart deployment/bob-inference -n ibm-bob
```

---

## Deployment Details

| Property | Value |
|----------|-------|
| Namespace | `ibm-bob` |
| Deployment | `bob-inference` |
| Image | `cp.icr.io/cp/bob/bob-inference` (SHA pinned) |
| Version | `1.26.7` |
| Replicas | 1 |
| TLS port | `7330` |
| Internal port | `7331` |
| ClusterIP | `172.30.45.161` |
| Gateway mode | `bifrost` |
| Budget checking | Enabled (Redis-backed) |
| Log level | `debug` |

**Resource limits:**

| | Request | Limit |
|-|---------|-------|
| CPU | 500m | 1 |
| Memory | 512Mi | 1Gi |
| Ephemeral storage | 1Gi | 5Gi |

---

## Reading the Logs

### Get live logs

```bash
oc logs -n ibm-bob -l app=bob-inference -f
```

### Get last N lines (snapshot)

```bash
oc logs -n ibm-bob -l app=bob-inference --tail=100
```

### Get logs for a specific pod by name

```bash
# List pods first
oc get pods -n ibm-bob -l app=bob-inference

# Tail a specific pod
oc logs -n ibm-bob <pod-name> --tail=200
```

### Get logs from a previous (crashed) pod

```bash
oc logs -n ibm-bob -l app=bob-inference --previous
```

### Filter for LLM inference requests only

```bash
oc logs -n ibm-bob -l app=bob-inference --tail=500 \
  | grep "chat/completions"
```

### Filter for errors only

```bash
oc logs -n ibm-bob -l app=bob-inference --tail=500 \
  | grep '"level":"error"'
```

---

## Understanding the Log Format

All log lines are structured JSON (except the startup banner). Key fields:

| Field | Description |
|-------|-------------|
| `level` | Log level: `info`, `debug`, `warn`, `error` |
| `ts` | UTC timestamp (ISO 8601) |
| `caller` | Source file and line number |
| `msg` | Human-readable message |
| `app` | Always `bob-inference` |
| `requestID` | Unique ID for this HTTP request |
| `correlationID` | Trace ID from the upstream caller |
| `method` | HTTP method (`GET`, `POST`) |
| `URL` | Request path (e.g. `/v1/chat/completions`) |
| `ip_address` | Source IP and port of the caller |
| `status_code` | HTTP response code |
| `time_elapsed` | Round-trip time in milliseconds |

### Startup sequence (healthy pod)

```
"Initizaling bootstrap"
"model pricing rules: … using built-in defaults"
"model alias table: … using built-in defaults"
"Starting Metering Dispatcher with 5 workers"
"Budget checking enabled"
"Router configured: 1 router(s) found in \"/src/config.yaml\""
"Gateway mode: bifrost — all requests handled by the embedded Bifrost gateway"
"Internal model gateway enabled at 0.0.0.0:7331"
"Starting http server with TLS options at address 0.0.0.0:7330"
```

If any of these lines are missing, the pod did not start cleanly.

### Successful LLM call (200)

```json
{"level":"info","msg":"received request","method":"POST","URL":"/v1/chat/completions","requestID":"…","correlationID":"…","ip_address":"10.x.x.x:…"}
{"level":"info","msg":"request completed","status_code":200,"time_elapsed":"1234ms","requestID":"…","correlationID":"…"}
```

### Failed LLM call (400 / 500)

```json
{"level":"info","msg":"received request","method":"POST","URL":"/v1/chat/completions","requestID":"…"}
{"level":"info","msg":"request completed","status_code":400,"time_elapsed":"0.682ms","requestID":"…"}
```

A `400` typically means a malformed request body (wrong model name, missing fields).
A `500` or `502` usually means the WXO upstream is unreachable or returned an error.
A very short `time_elapsed` on a non-200 means the request was rejected locally before
reaching WXO.

### Health check calls (normal, can be ignored)

```json
{"msg":"received request","method":"GET","URL":"/v1/model/info","status_code":200,"time_elapsed":"0.4ms"}
```

These are periodic liveness/readiness probes from OpenShift and can be filtered out:

```bash
oc logs -n ibm-bob -l app=bob-inference --tail=500 \
  | grep -v "model/info"
```
