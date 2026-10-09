# Robot Shop — SRE Context Reference

> This document is the grounded reference for all Bob SRE agents. When Instana reports an incident,
> agents cross-reference this topology to explain *why* a service failed, *what code is involved*,
> and *which Ansible task will fix it*.

---

## Application Overview

**Stan's Robot Shop** is the Instana reference polyglot microservices application — an e-commerce
store for robots. It runs on OpenShift in the `robot-shop` namespace and is fully instrumented with
the Instana agent for distributed tracing, metrics, and incident detection.

**Source:** `robot-shop/` (cloned from https://github.com/instana/robot-shop)
**Helm templates:** `robot-shop/K8s/helm/templates/`
**OpenShift install:** `helm install robot-shop --set openshift=true -n robot-shop helm`

---

## Service Topology

```
Browser
  └── web (Nginx :8080)
        ├── catalogue (Node.js :8080) ──► MongoDB :27017
        ├── user     (Node.js :8080) ──► MongoDB :27017, Redis :6379
        ├── cart     (Node.js :8080) ──► Redis :6379, catalogue
        ├── payment  (Python  :8080) ──► RabbitMQ :5672, user, cart
        ├── shipping (Java    :8080) ──► MySQL :3306, RabbitMQ :5672
        └── ratings  (PHP     :8080) ──► MySQL :3306
                                  ▼
                           dispatch (Go) ◄── RabbitMQ :5672
```

---

## Per-Service SRE Reference

### web — Nginx frontend
- **Image:** `robotshop/rs-web:latest`
- **Deployment:** `robot-shop/K8s/helm/templates/web-deployment.yaml`
- **Port:** 8080
- **Failure signatures:** HTTP 502/503 → upstream service down; 504 → upstream timeout
- **Instana:** Tracks HTTP error rates across all routes; upstream call spans visible in trace
- **Fix:** Check which downstream service is returning errors via Instana call chain

### cart — Shopping cart (Node.js)
- **Image:** `robotshop/rs-cart:latest`
- **Source:** `robot-shop/cart/server.js`
- **Key env vars:** `REDIS_HOST` (default: `redis`), `CATALOGUE_HOST` (default: `catalogue`)
- **Resource limits:** CPU 200m / Memory **100Mi** ← tight; OOMKill risk under load
- **Instana instrumentation:** `@instana/collector` initialized at top of `server.js`
- **Failure signatures:**
  - Redis `ECONNREFUSED` → `redisConnected = false` in code, cart returns 500
  - OOMKilled (100Mi limit exceeded under cart load)
- **Ansible fix:** Increase memory limit or restart Redis StatefulSet

### catalogue — Product catalog (Node.js)
- **Image:** `robotshop/rs-catalogue:latest`
- **Source:** `robot-shop/catalogue/server.js`
- **Key dependency:** MongoDB (`MONGO_HOST` env, default: `mongodb`)
- **Resource limits:** CPU 200m / Memory 100Mi
- **Failure signatures:** MongoDB connection pool exhaustion, slow product queries
- **Ansible fix:** Restart MongoDB deployment or scale catalogue replicas

### user — User accounts (Node.js)
- **Image:** `robotshop/rs-user:latest`
- **Source:** `robot-shop/user/server.js`
- **Key dependencies:** MongoDB (`MONGO_HOST`), Redis (`REDIS_HOST`)
- **Resource limits:** CPU 200m / Memory 100Mi
- **Failure signatures:** Login failures → MongoDB or Redis unreachable; payment auth failures cascade from here
- **Ansible fix:** Check MongoDB/Redis pod health; restart user deployment

### payment — Order payment (Python/Flask)
- **Image:** `robotshop/rs-payment:latest`
- **Source:** `robot-shop/payment/payment.py`
- **Key env vars:** `CART_HOST` (default: `cart`), `USER_HOST` (default: `user`), `PAYMENT_GATEWAY`
- **Key dependency:** RabbitMQ publisher (`robot-shop/payment/rabbitmq.py`), user service
- **Resource limits:** CPU 200m / Memory 100Mi
- **Health endpoint:** `GET /health` returns 200
- **Failure signatures:**
  - RabbitMQ publish failure → orders silently drop
  - User service upstream 500 → payment returns 500 to web
- **Ansible fix:** Restart RabbitMQ deployment; check user service

### shipping — Order shipping (Java/Spring Boot)
- **Image:** `robotshop/rs-shipping:latest`
- **Source:** `robot-shop/shipping/src/main/java/com/instana/robotshop/shipping/`
- **Key files:** `Controller.java`, `RetryableDataSource.java`, `ShippingServiceApplication.java`
- **Key dependencies:** MySQL (JPA via `RetryableDataSource`), RabbitMQ
- **Resource limits:** CPU 200m / Memory **1000Mi** (Java heap — largest of all services)
- **Readiness probe:** `GET /health :8080` — `initialDelaySeconds: 5`, `failureThreshold: 30`
- **Notable code:** `Controller.java` has a `/memory` endpoint that deliberately leaks 25MB per call
  (demo chaos endpoint — if hit repeatedly causes OOMKill)
- **Failure signatures:**
  - `readinessProbe` failing → Pod not-ready, Endpoints removed, web gets 503 for shipping routes
  - MySQL connection refused → `RetryableDataSource` retries then throws; shipping returns 500
  - Java heap pressure → GC pauses, slow responses, eventual OOMKill
- **Ansible fix:** Restart MySQL deployment; rollout restart shipping deployment; patch memory limit

### ratings — Product ratings (PHP)
- **Image:** `robotshop/rs-ratings:latest`
- **Source:** `robot-shop/ratings/`
- **Key dependency:** MySQL (PHP PDO)
- **Resource limits:** CPU 200m / Memory 100Mi
- **Failure signatures:** MySQL PDO `SQLSTATE` errors; ratings endpoint returns 500
- **Ansible fix:** Restart MySQL; restart ratings deployment

### dispatch — Order dispatch consumer (Go)
- **Image:** `robotshop/rs-dispatch:latest`
- **Source:** `robot-shop/dispatch/main.go`
- **Key dependency:** RabbitMQ (AMQP consumer — processes orders from payment)
- **No HTTP port** — pure queue consumer
- **Failure signatures:** Silent order processing failure; RabbitMQ queue depth grows; Go panic in logs
- **Ansible fix:** Restart dispatch deployment; check RabbitMQ health

### mongodb — Document store
- **Image:** MongoDB (official)
- **Port:** 27017
- **Used by:** catalogue, user
- **Failure signatures:** OOMKilled, storage full, slow queries visible in Instana DB spans
- **Ansible fix:** Restart mongodb deployment; check PVC usage

### mysql — Relational store
- **Image:** MySQL (official)
- **Port:** 3306
- **Used by:** shipping (JPA), ratings (PDO)
- **Failure signatures:** Connection refused, slow query log entries in pod logs
- **Ansible fix:** Restart mysql deployment

### redis — Cache/session store
- **Image:** Redis (official, StatefulSet)
- **Port:** 6379
- **Used by:** cart, user
- **Ansible fix:** Rollout restart redis StatefulSet (`oc rollout restart statefulset/redis -n robot-shop`)

### rabbitmq — Message broker
- **Image:** RabbitMQ (official)
- **Ports:** 5672 (AMQP), 15672 (management)
- **Used by:** payment (publisher), dispatch (consumer), shipping (consumer)
- **Failure signatures:** Queue depth spike → payment/dispatch/shipping all affected simultaneously
- **Ansible fix:** Restart rabbitmq deployment

---

## Deployment Facts (Helm)

| Setting | Value |
|---|---|
| Namespace | `robot-shop` |
| Helm release name | `robot-shop` |
| Image repo prefix | `robotshop/rs-<service>:latest` |
| Default replicas | 1 per service |
| Pod label | `service: <name>` |
| Instana env var | `INSTANA_AGENT_HOST: status.hostIP` (injected in all deployments) |
| OpenShift route | Exposed on `web` service port 8080 |

---

## Common Instana Incident → Robot Shop Root Cause Matrix

| Instana Incident | Likely Root Cause | Affected Users | Priority Fix |
|---|---|---|---|
| High error rate on `cart` | Redis unreachable or OOMKilled | Cannot add to cart | Restart redis / increase cart memory limit |
| High latency on `catalogue` | MongoDB slow query or connection pool full | Slow product browse | Restart mongodb / check indexes |
| Payment 5xx spike | RabbitMQ publish failure OR user service down | Orders failing at checkout | Check rabbitmq + user service |
| Shipping readinessProbe failed | MySQL down OR Java heap exhausted | Shipping cost/ETA unavailable | Restart mysql / rollout restart shipping |
| Dispatch queue depth growing | RabbitMQ consumer lag (dispatch pod crash) | Orders not being dispatched | Restart dispatch deployment |
| Web 502 errors | Any downstream service returning 5xx | Entire storefront degraded | Identify which service via Instana call chain |

---

## Ansible Remediation Patterns

```yaml
# Pattern 1: Rollout restart a Robot Shop deployment
- name: Restart <service> deployment
  kubernetes.core.k8s:
    state: present
    definition:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: <service>
        namespace: robot-shop
        annotations:
          kubectl.kubernetes.io/restartedAt: "{{ ansible_date_time.iso8601 }}"

# Pattern 2: Restart Redis StatefulSet
- name: Restart redis statefulset
  ansible.builtin.shell: |
    oc rollout restart statefulset/redis -n robot-shop

# Pattern 3: Patch a deployment's memory limit
- name: Patch cart memory limit
  kubernetes.core.k8s:
    state: patched
    api_version: apps/v1
    kind: Deployment
    name: cart
    namespace: robot-shop
    definition:
      spec:
        template:
          spec:
            containers:
              - name: cart
                resources:
                  limits:
                    memory: "200Mi"
```
