# us-east-1 coupling and request flow

This site does **not** serve every request from us-east-1. Runtime traffic is handled at the nearest CloudFront edge location. The origin bucket is in `eu-west-1`, and us-east-1 is mainly the control-plane and auth home region required by CloudFront, Lambda@Edge, ACM, and Cognito.

## Normal request path

```mermaid
flowchart LR
  Browser["Visitor browser"]
  Edge["Nearest CloudFront edge"]
  EdgeLambda["Replicated Lambda@Edge\nviewer-request handler"]
  Cache{"CloudFront cache hit?"}
  S3["Private S3 origin\ns3.eu-west-1.amazonaws.com"]

  Browser --> Edge
  Edge --> EdgeLambda
  EdgeLambda --> Cache
  Cache -- "yes" --> Browser
  Cache -- "no" --> S3
  S3 --> Edge
  Edge --> Browser
```

The Lambda@Edge code is authored and versioned in us-east-1, but CloudFront replicates that published version to edge locations. A London visitor normally runs the edge copy near London, not the original us-east-1 Lambda runtime.

## Authenticated request path

```mermaid
sequenceDiagram
  participant B as Browser
  participant CF as CloudFront edge
  participant LE as Lambda@Edge copy
  participant CG as Cognito us-east-1
  participant S3 as S3 origin eu-west-1

  B->>CF: GET /diary/
  CF->>LE: viewer-request
  LE->>LE: Check id_token cookie
  alt Valid cached/JWT-verifiable token
    LE-->>CF: Pass request, rewrite to /diary/index.html
    CF->>S3: Fetch object if cache miss
    S3-->>CF: Object
    CF-->>B: Page
  else Missing or invalid token
    LE-->>B: 302 to Cognito Hosted UI
    B->>CG: Sign in with Google via Hosted UI
    CG-->>B: 302 /callback?code=...
    B->>CF: GET /callback?code=...
    CF->>LE: viewer-request
    LE->>CG: Exchange code for tokens
    LE->>CG: Fetch JWKS if not cached
    LE-->>B: Set id_token + refresh_token cookies, 302 back
  end
```

The steady-state page request can stay local to CloudFront edge plus cache. us-east-1 is contacted during login, callback token exchange, hourly refresh-token exchanges once the ID token lapses, and occasional JWKS refreshes from a warm edge Lambda process.

## Shopping list path

```mermaid
sequenceDiagram
  participant B as Browser (/shopping/)
  participant CF as CloudFront edge
  participant API as Shopping API Lambda us-east-1
  participant DB as DynamoDB us-east-1
  participant EV as AppSync Events us-east-1

  B->>CF: GET /api/shopping (id_token cookie)
  CF->>API: /api/* behaviour, signed with OAC
  API->>DB: Scan every cart
  API-->>B: Carts + Events endpoints
  B->>EV: WebSocket subscribe /shopping/home (ID token from /token)
  B->>CF: POST /api/shopping/carts/home/ops
  CF->>API: forward
  API->>DB: Write changed records
  API->>EV: Publish cart-changed (IAM)
  EV-->>B: cart-changed on other tabs/devices, which reload the cart
```

Unlike the static pages, every shopping list read and write goes to us-east-1 (uncached), and open pages hold a WebSocket to the us-east-1 Events API. If us-east-1 is unreachable, the page keeps working from its cached copy and queues changes until it can reach the API again.

## Deployment and control-plane coupling

```mermaid
flowchart TB
  subgraph USE1["us-east-1"]
    Artifacts["Versioned Lambda artifact bucket"]
    AccessConfig["SSM authentication allow list"]
    Cognito["Cognito user pool\nHosted UI + Google IdP"]
    CognitoAllowList["Cognito allow-list Lambda"]
    AuthSource["Auth Lambda@Edge source function"]
    AuthVersion["Published Lambda version"]
    ACM["ACM certificate for CloudFront"]
    CFConfig["CloudFront distribution config"]
  end

  subgraph Global["CloudFront global edge network"]
    EdgeCopies["Replicated Lambda@Edge copies"]
    Cache["Edge caches"]
  end

  subgraph EUW1["eu-west-1"]
    SiteBucket["Private S3 site bucket\ndonandmartina.com"]
  end

  Artifacts --> CognitoAllowList
  AccessConfig --> CognitoAllowList
  CognitoAllowList --> Cognito
  Cognito --> AuthSource
  Artifacts --> AuthSource
  AuthSource --> AuthVersion
  ACM --> CFConfig
  AuthVersion --> CFConfig
  CFConfig --> EdgeCopies
  SiteBucket --> Cache
```

The site stack is deployed in us-east-1 because CloudFront requires its ACM certificate there, and Lambda@Edge requires the associated function version there. The static content deploy uses `eu-west-1` because that is where the origin bucket lives.

## Coupling surface summary

| Surface | Region | Request-time? | Why it exists |
|---|---:|---:|---|
| CloudFront edge cache and Lambda@Edge replica | nearest edge | yes | Handles viewer requests close to the visitor. |
| S3 origin bucket | eu-west-1 | cache misses only | Stores the generated Hugo site. |
| Auth Lambda@Edge source function and version | us-east-1 | no, except as source for replicas | Lambda@Edge functions must be created and versioned in us-east-1. |
| Cognito Hosted UI and user pool | us-east-1 | login/callback only | Provides Google-backed sign-in and token issuer. |
| Cognito JWKS endpoint | us-east-1 | occasional | Edge Lambda validates JWT signatures and caches JWKS in-process. |
| Cognito allow-list Lambda | us-east-1 | signup, authentication and hourly token refresh | Cognito triggers gate allowed emails against Parameter Store. |
| Shopping API Lambda + DynamoDB | us-east-1 | every shopping list load and change | Stores the shared carts behind `/api/*`. |
| AppSync Events API | us-east-1 | while a shopping page is open | Notifies open pages when a cart changes. |
| ACM certificate | us-east-1 | TLS control plane | CloudFront viewer certificates must be in us-east-1. |
| Lambda artifact bucket | us-east-1 | deploy only | Lambda fetches zips from its own region; cross-region artifacts cause redirects. |
| CloudFormation stacks | us-east-1 | deploy only | Owns the CloudFront, ACM, Lambda@Edge, Cognito, and shopping backend resources. |

## Mental model

Think of us-east-1 as the **auth and edge-control home region**, and the home of the shopping list's data, not as the main content-serving region. Static pages are primarily served by CloudFront edge locations, with `eu-west-1` S3 as the origin behind the cache.
