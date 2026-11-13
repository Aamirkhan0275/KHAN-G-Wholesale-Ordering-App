"""KHAN G ordering walkthrough: a shopkeeper orders cartons in Urdu and sends it on WhatsApp,
then the owner checks availability, confirms (stock is deducted) and issues the private invoice.

Recorded with: devbench video record khan-g-walkthrough --base <app url>
Runs against demo data (SEED_DEMO=true). It places a real order in that database.
"""

TITLE = "KHAN G ordering walkthrough"


def take(t):
    t.goto("/")
    t.mark_ready()
    t.say("KHAN G — wholesale ordering app. It opens in Urdu, right-to-left.", 3.6)

    t.beat("input[name='phone']", "A shopkeeper signs in with their mobile number and PIN.", 3.0)
    t.type_into("input[name='phone']", "0300 1110001")
    t.type_into("input[name='password']", "shop1234")
    t.click("button[type='submit']", after=2.5)

    t.say("The catalogue: big photos, Urdu names, availability and price on every card.", 4.0)
    t.beat("[data-testid='search']", "Search works in Urdu or English.", 2.6)
    t.type_into("[data-testid='search']", "بسکٹ")
    t.wait(1.5)
    t.hold_caption("Tap Add, then the big + button for more cartons.")
    t.click("[data-testid='product-card']:not(.out) [data-testid='add-btn']", after=1.0)
    t.click("[data-testid='product-card']:not(.out) .stepper .plus", after=0.8)
    t.click("[data-testid='product-card']:not(.out) .stepper .plus", after=1.2)
    t.release_caption()
    t.beat("[data-testid='cart-bar']", "The cart bar always shows items and cartons.", 3.0)
    t.click("[data-testid='cart-bar']", after=2.0)

    t.say("Review the cart: change quantities, remove items, see the estimated total.", 3.8)
    t.beat("[data-testid='place-order']", "Place order saves it in the app first.", 2.8)
    t.click("[data-testid='place-order']", after=2.5)

    t.beat("[data-testid='order-ref']", "Every order gets a reference number.", 3.0)
    t.beat("[data-testid='send-wa']", "Then one tap opens WhatsApp with the full order — the shopkeeper presses Send there.", 4.6)

    t.say("Now the owner's side, in English on a laptop.", 2.8)
    t.goto("/account")
    t.click("[data-testid='logout']", after=2.0)
    t.click("[data-testid='lang-toggle']", after=1.0)
    t.type_into("input[name='phone']", "0300 0000001")
    t.type_into("input[name='password']", "KhanG@admin1")
    t.click("button[type='submit']", after=2.5)

    t.beat("[data-testid='stat-new']", "The dashboard shows new orders, low stock and balances.", 3.6)
    t.click("[data-testid='stat-new']", after=2.0)
    t.click("[data-testid='admin-orders'] tbody tr:first-child", after=2.5)

    t.beat("[data-testid='review-table']", "The owner sets the available quantity for each line, with a note the shop will see.", 4.2)
    t.click("[data-testid='approve-all']", after=1.0)
    t.click("[data-testid='save-review']", after=2.0)
    t.click("[data-testid='to-confirmed']", after=1.0)
    t.beat("[data-testid='apply-status']", "Confirming deducts the stock and tells the shopkeeper.", 3.2)
    t.click("[data-testid='apply-status']", after=2.5)

    t.beat("[data-testid='create-invoice']", "Then a private invoice is created from the approved quantities.", 3.4)
    t.click("[data-testid='create-invoice']", after=2.0)
    t.click("[data-testid='invoice-link']", after=2.5)
    t.beat("[data-testid='invoice-sheet']", "Only the owner and that shop can open it, or download it as PDF.", 4.2)

    t.say("Also included: ledger and payments, reports with CSV, weekly in-app reorder reminders, dark mode, and install as an app.", 5.0)
    t.clear_caption()
    t.wait(1.4)
