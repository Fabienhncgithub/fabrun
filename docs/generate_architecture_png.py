from PIL import Image, ImageDraw, ImageFont
from textwrap import wrap

W, H = 2200, 1600
BG = (248, 250, 252)
TXT = (15, 23, 42)
MUTED = (71, 85, 105)
BLUE = (219, 234, 254)
GREEN = (220, 252, 231)
ORANGE = (255, 237, 213)
PURPLE = (237, 233, 254)
GRAY = (226, 232, 240)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

try:
    title_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 46)
    h_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 28)
    b_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 22)
    s_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 19)
except Exception:
    title_font = ImageFont.load_default()
    h_font = ImageFont.load_default()
    b_font = ImageFont.load_default()
    s_font = ImageFont.load_default()


def draw_wrapped_text(text, x, y, max_width, font, fill=TXT, line_gap=7):
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        candidate = (cur + " " + w).strip()
        bbox = d.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_width:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)

    yy = y
    for line in lines:
        d.text((x, yy), line, font=font, fill=fill)
        bb = d.textbbox((0, 0), line, font=font)
        yy += (bb[3] - bb[1]) + line_gap
    return yy


def box(x1, y1, x2, y2, title, body, fill):
    d.rounded_rectangle((x1, y1, x2, y2), radius=20, outline=(148, 163, 184), width=3, fill=fill)
    d.text((x1 + 18, y1 + 14), title, font=h_font, fill=TXT)
    draw_wrapped_text(body, x1 + 18, y1 + 60, (x2 - x1) - 36, b_font, fill=TXT)


def arrow(x1, y1, x2, y2, label=None):
    d.line((x1, y1, x2, y2), fill=(51, 65, 85), width=4)
    # Arrow head
    if abs(x2 - x1) >= abs(y2 - y1):
        if x2 > x1:
            p1 = (x2 - 16, y2 - 9)
            p2 = (x2 - 16, y2 + 9)
        else:
            p1 = (x2 + 16, y2 - 9)
            p2 = (x2 + 16, y2 + 9)
    else:
        if y2 > y1:
            p1 = (x2 - 9, y2 - 16)
            p2 = (x2 + 9, y2 - 16)
        else:
            p1 = (x2 - 9, y2 + 16)
            p2 = (x2 + 9, y2 + 16)
    d.polygon([(x2, y2), p1, p2], fill=(51, 65, 85))

    if label:
        lx = (x1 + x2) // 2 + 10
        ly = (y1 + y2) // 2 - 28
        d.rounded_rectangle((lx - 10, ly - 5, lx + 360, ly + 28), radius=8, fill=(241, 245, 249), outline=(203, 213, 225))
        d.text((lx, ly), label, font=s_font, fill=MUTED)


# Title
d.text((70, 40), "FabRun - Architecture complete (API + Front)", font=title_font, fill=TXT)
draw_wrapped_text(
    "Schema pratique pour comprendre qui appelle quoi, ou vont les donnees, et ou sont les calculs metier.",
    70,
    100,
    1400,
    b_font,
    fill=MUTED,
)

# Main blocks
box(
    70,
    180,
    640,
    560,
    "1) Frontend (React/Vite)",
    "Fichiers clefs: strava-front/src/App.tsx et strava-front/src/api.ts. "
    "Le front lit le token Strava dans le hash URL, appelle les endpoints API et affiche les cartes: KPIs, activities, predictions, shoes.",
    BLUE,
)

box(
    770,
    180,
    1440,
    560,
    "2) API ASP.NET Core",
    "Entree: Program.cs (DI, CORS, Swagger, controllers). "
    "Controllers principaux: AuthController, ActivitiesController, PredictionsController, HealthSleepController. "
    "Les controllers orchestrent les services et renvoient du JSON au front.",
    GREEN,
)

box(
    1570,
    180,
    2130,
    560,
    "3) Strava Cloud API",
    "Appels externes via StravaService (OAuth, athlete, activities, streams, details). "
    "Toutes les donnees sportives sources viennent de l API Strava.",
    ORANGE,
)

box(
    770,
    640,
    1440,
    1030,
    "4) Services metier",
    "StravaService: appels HTTP + MemoryCache. "
    "BestEffortsService: calcule meilleurs efforts (1k/5k/10k/HM/M) via streams/splits. "
    "PredictionMath: calibrage exponent + score de confiance. "
    "HealthSleepService: sessions sommeil + resume 7j/30j.",
    PURPLE,
)

box(
    1570,
    640,
    2130,
    1030,
    "5) Stockage local",
    "Fichiers JSON en local: Data/best-efforts.json et Data/health-sleep.json. "
    "Utilise pour persister les snapshots best efforts et les donnees sommeil par athlete.",
    GRAY,
)

box(
    70,
    640,
    640,
    1030,
    "6) Modeles / DTO",
    "Modeles utilises comme DTO API (meme sans suffixe Dto): "
    "PredictionResponse, SleepUploadRequest, Activity, Kpis, AthleteProfile, etc.",
    BLUE,
)

# Arrows main flow
arrow(640, 370, 770, 370, "HTTP JSON + Bearer token")
arrow(1440, 370, 1570, 370, "Appels https://www.strava.com/api/v3")
arrow(1110, 560, 1110, 640, "Controllers -> Services")
arrow(1440, 835, 1570, 835, "Lecture/ecriture JSON")
arrow(770, 930, 640, 930, "Retour objets metier/DTO")

# Explanation panel
panel_x1, panel_y1, panel_x2, panel_y2 = 70, 1100, 2130, 1540
d.rounded_rectangle((panel_x1, panel_y1, panel_x2, panel_y2), radius=22, outline=(148, 163, 184), width=3, fill=(255, 255, 255))
d.text((panel_x1 + 20, panel_y1 + 16), "Lecture rapide des flux", font=h_font, fill=TXT)

explanations = [
    "A) Login: App.tsx redirige vers /auth/login -> Strava OAuth -> /oauth/callback -> token dans URL hash.",
    "B) Chargement dashboard: GET /api/dashboard -> ActivitiesController -> StravaService + HealthSleepService -> JSON agrege (activities, kpis, profile, sleep).",
    "C) Predictions: GET /api/predictions/running -> PredictionsController -> BestEffortsService + PredictionMath + BestEffortsStoreService.",
    "D) Performance: MemoryCache limite les appels repetes a Strava; snapshots JSON evite de recalculer trop souvent.",
    "E) Point cle architecture: controllers minces, logique metier concentree dans Services, UI dans composants React.",
]

y = panel_y1 + 66
for item in explanations:
    y = draw_wrapped_text(item, panel_x1 + 28, y, (panel_x2 - panel_x1) - 56, b_font, fill=TXT, line_gap=10)
    y += 4

# Footer
footer = "Fichiers references: Program.cs | Controllers/* | Services/* | Models/* | strava-front/src/App.tsx | strava-front/src/api.ts"
d.text((70, 1550), footer, font=s_font, fill=MUTED)

out = "docs/architecture-expliquee.png"
img.save(out, format="PNG")
print(out)
