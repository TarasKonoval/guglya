# Ґуґля (Guglya)

> **EN:** Mobile-first website with ready-made trendy seasonal outfits built only from Ukrainian brands' items; AI suggests similar alternatives from other brands, and every click leads to the brand's own product page. React + FastAPI on AWS (Cognito, Lambda, RDS Postgres + pgvector, S3/CloudFront), all in Terraform.

**Ґуґля — сайт із готовими трендовими образами на сезон, зібраними з речей виключно українських брендів.**

Мета: щоб людина виглядала стильно без зусиль і обирала українське. Готові образи, речі в яких пасують одна до одної, показують, як носити тренди цього сезону, і підходять під будь-який бюджет.
**Обираєш образ — і одягаєшся в українське за кілька хвилин.**

- **Для кого:** студенти й молодь 19–35 років у великих містах, які шукають ідеї образів в Instagram/TikTok/Pinterest і купують одяг зі смартфона (72 % онлайн-оплат за одяг). Не хочуть годинами ходити окремими сайтами брендів.
- **Перша версія:** образи на осінь; для кожної речі AI підбирає схожі альтернативи в **інших** українських брендів; видно ціну кожної речі й суму образу; клік відкриває сторінку товару на сайті бренду, де й відбувається покупка.
- **Формат «АутфітЧек»:** як у наших коротких відео в TikTok/Reels: образ, бренд і ціна кожної речі, загальна сума.
- **Валідація:** показуємо прототип 20–30 потенційним користувачам і 10 брендам. Ключова метрика: частка тих, хто переглянув образ і перейшов на товар бренду (ціль ≥ 1 із 10).

**Команда:** Андрій Гуменюк, Тарас Коновал (Український католицький університет).

**Демо:** https://d2lxh7fc98a19v.cloudfront.net · **API:** https://bn43uwfr9f.execute-api.eu-central-1.amazonaws.com/health

> Зараз на сайті **демо-каталог**: 8 вигаданих брендів, 60 речей, 10 осінніх образів; ілюстрації намальовані нами, а «До бренду →» веде на нашу сторінку `/demo/<id>`. Реальні каталоги додаємо лише від брендів, які дали дозвіл на використання фото.

| Стрічка | Образ і заміни | АутфітЧек |
| --- | --- | --- |
| ![Стрічка](docs/screenshots/feed-mobile.jpg) | ![Образ](docs/screenshots/outfit-mobile.jpg) | ![Купити речі](docs/screenshots/outfitcheck-mobile.jpg) |

![Сторінка образу на десктопі](docs/screenshots/outfit-desktop.jpg)

## Як працює AI-підбір

1. Для кожного фото товару офлайн рахуємо ембединг моделлю **FashionCLIP** (`patrickjohncyh/fashion-clip`, CLIP, донавчений на фото одягу): нормалізований вектор на 512 чисел, що кодує крій, колір і фактуру (`backend/ml/embed.py`, на Mac працює на GPU через MPS).
2. Вектори зберігаються в Postgres у колонці `products.embedding` (розширення **pgvector**).
3. `GET /outfits/{id}/similar/{slot}` бере оригінальну річ образу й шукає найближчі за косинусною відстанню (`<=>`) речі тієї ж категорії, що є в наявності, **лише в інших брендів**, спершу по одній від кожного бренду. Є опційний фільтр кольору, а також різниця в ціні з оригіналом.

## Архітектура

```mermaid
flowchart LR
  U[Користувач<br/>смартфон] -->|HTTPS| CF[CloudFront<br/>*.cloudfront.net]
  CF -->|OAC| S3[(S3: React SPA<br/>+ /img/ фото)]
  U -->|signUp / signIn<br/>aws-amplify| COG[Cognito User Pool]
  COG -.->|pre-sign-up trigger<br/>auto-confirm| PSL[Lambda presignup]
  U -->|Bearer ID token| APIGW[API Gateway<br/>HTTP API]
  APIGW --> L[Lambda: FastAPI<br/>container arm64 + Mangum]
  L -->|SSL, приватно у VPC| RDS[(RDS PostgreSQL 16<br/>+ pgvector)]
  ECR[(ECR)] -.->|образ| L
  DEV[Ноутбук: migrate.py,<br/>import_catalog.py, embed.py,<br/>stats.py] -->|SSL, лише з IP розробника| RDS
```

- **Auth:** Cognito (email + пароль від 8 символів). Pre-sign-up Lambda одразу підтверджує акаунт, тож тестувальник входить без коду з пошти.
- **Backend:** FastAPI у Lambda (VPC за замовчуванням, без NAT), тому JWKS Cognito і `DATABASE_URL` Terraform передає як змінні середовища. Токен перевіряється за RS256 / `iss` / `aud` / `token_use=id`. CORS налаштований лише у FastAPI.
- **Дані для звіту:** `users` (кожен запит із токеном оновлює рядок), `events` (`outfit_view`, `swap`, `donate_click`, `feedback_open`), `clicks` (з позначкою `is_alternative`), `feedback` (оцінка, «чи купили б», текст).

### Структура репозиторію

```
backend/            FastAPI (app/), Lambda handler, Dockerfile (локально) і Dockerfile.lambda
  ml/               import_catalog.py (CSV/JSON → БД), embed.py (FashionCLIP → pgvector)
  scripts/          migrate.py (міграції), stats.py (цифри для звіту)
frontend/           React + Vite + TypeScript, aws-amplify v6
infra/
  terraform/        уся AWS-інфраструктура (Cognito, RDS, Lambda, API GW, S3, CloudFront, ECR, SSM, Budget)
  db/migrations/    SQL-схема
  deploy-backend.sh, deploy-frontend.sh, seed-demo.sh, docker-compose.yml
data/demo/          генератор демо-каталогу, catalog.csv, outfits.json, img/
docs/               шаблон звіту, скріншоти
```

## Локальний запуск

Потрібно: Node 20+, Python 3.12+, Docker, AWS CLI. Інфраструктура вже розгорнута (див. «Деплой»), локально запускаємо лише код, який ходить у ту саму RDS (ваш IP має бути в `my_ip_cidr`).

```bash
export AWS_PROFILE=guglya AWS_REGION=eu-central-1
cd infra/terraform && terraform output && cd ../..

# Backend
cd backend
cp .env.example .env    # DATABASE_URL: aws ssm get-parameter --name /guglya/database_url --with-decryption --query Parameter.Value --output text
                        # COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID з terraform output
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000/docs
# або: docker compose -f infra/docker-compose.yml up --build

# Frontend
cd frontend
cp .env.example .env    # VITE_* з terraform output; VITE_API_URL=http://localhost:8000; VITE_ASSET_BASE_URL=<cloudfront_url>
npm install && npm run dev             # http://localhost:5173
```

## Деплой (з нуля)

```bash
export AWS_PROFILE=guglya              # IAM-користувач з правами адміністратора (не root)
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # email для бюджету + ваш IP: echo "$(curl -s https://checkip.amazonaws.com)/32"
terraform init

# a) Cognito, S3 + CloudFront, ECR, бюджет
terraform apply -target=aws_cognito_user_pool_client.web -target=aws_lambda_permission.cognito_presignup \
  -target=aws_iam_role_policy_attachment.presignup_logs -target=aws_s3_bucket_policy.frontend \
  -target=aws_s3_bucket_public_access_block.frontend -target=aws_ecr_lifecycle_policy.backend -target=aws_budgets_budget.monthly
# b) RDS + security groups + SSM (~10 хв)
terraform apply -target=aws_ssm_parameter.database_url -target=aws_ssm_parameter.db_password
cd ../..
infra/deploy-backend.sh                # перший образ у ECR
terraform -chdir=infra/terraform apply # c) Lambda + API Gateway

pip install -r backend/requirements-ml.txt   # у backend/.venv
infra/seed-demo.sh                     # міграції, фото → S3 /img/, демо-каталог, ембединги
VITE_DONATE_URL=https://send.monobank.ua/jar/XXXX infra/deploy-frontend.sh
```

Оновлення коду: `infra/deploy-backend.sh` (білд arm64 → ECR → Lambda → перевірка `/health`) і `infra/deploy-frontend.sh` (білд → S3 → інвалідація CloudFront). Змінився IP ноутбука? Оновіть `my_ip_cidr` у `terraform.tfvars` і виконайте `terraform apply`.

## Реальний каталог

1. Заповнити `data/catalog.csv` (колонки: `brand, brand_site, title, category, color, price_uah, image_url, product_url, in_stock`; `category` ∈ hat/top/bottom/shoes) і `data/outfits.json` (`title, season, cover_image_url, style_tag, items {slot: product_url}`; шапка необовʼязкова). Приклади: `data/catalog.example.csv`, `data/outfits.example.json`. Лише фото брендів, які дали дозвіл.
2. Імпорт і ембединги:
   ```bash
   export DATABASE_URL=$(aws ssm get-parameter --name /guglya/database_url --with-decryption --query Parameter.Value --output text)
   export IMAGE_BASE_URL=$(terraform -chdir=infra/terraform output -raw cloudfront_url)   # для відносних /img/ шляхів
   python backend/ml/import_catalog.py --purge-demo data/catalog.csv data/outfits.json
   python backend/ml/embed.py           # рахує лише товари без ембедингу
   ```
   `--purge-demo` ховає демо-дані (знімає з публікації, «немає в наявності»), але не видаляє їх, щоб кліки й події з демо залишились у звіті.

## Статистика для звіту

```bash
python backend/scripts/stats.py                                          # за весь час
python backend/scripts/stats.py --since 2026-11-17 --until 2026-11-18    # раунд 1 (час Києва)
```
Виводить: зареєстрованих користувачів, хто переглянув образ, хто перейшов на бренд, click-through (ціль ≥ 10 %), кліки на AI-альтернативи проти оригінальних речей, кліки по брендах і образах, кліки на «Підтримати збір», кількість відгуків, середню оцінку та розподіл «чи купили б». Шаблон звіту: `docs/report-template.md`.

## Вартість і видалення

Орієнтовно **~$20/міс**: RDS db.t4g.micro (~$13) + 20 GB gp3 (~$2.5) + публічна IPv4-адреса RDS (~$3.6). Lambda, API Gateway, Cognito (до 10 000 MAU), S3, CloudFront і ECR на нашому обсязі коштують центи. На новому акаунті частину покриває Free Tier. Бюджет-алерт на $30/міс надсилає листи на 50/80/100 %.

Видалити все:
```bash
terraform -chdir=infra/terraform destroy    # RDS без фінального снапшоту; S3 і ECR очищаються автоматично
```

## API

| Метод | Шлях | Auth | Що |
| --- | --- | --- | --- |
| GET | `/health` | — | перевірка |
| GET | `/me` | так | поточний користувач (+ реєстрація в `users`) |
| GET | `/outfits?season=autumn` | — | стрічка: образи із сумою та прев'ю речей |
| GET | `/outfits/{id}` | — | образ з оригінальними речами по слотах |
| GET | `/outfits/{id}/similar/{slot}?color=&limit=5` | — | AI-альтернативи (pgvector) з різницею ціни |
| GET | `/products/{id}` | — | товар (для сторінки `/demo/:id`) |
| POST | `/clicks` | опц. | логує клік, повертає URL бренду з UTM |
| POST | `/events` | опц. | `outfit_view` / `swap` / `donate_click` / `feedback_open` |
| GET/POST/DELETE | `/saved[/{outfit_id}]` | так | збережені образи |
| POST | `/feedback` | так | оцінка, «чи купили б», текст |
