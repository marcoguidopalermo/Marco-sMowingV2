# Service categories from Jobber line items — agreed mapping (2026-10-20)

Status: **agreed spec, not built.** Decisions by Marco on 2026-10-20 after a
read-only look at this year's Jobber line items. Two items are still open
(see "Waiting on Marco").

## Categories

Lawn mowing · Lawn care · Hedges & shrubs · Sod · Cleanups · Garden beds &
landscaping · Hardscape & gravel · Tree & stump · Snow · **Sweeping** · Other

Plus two buckets that are not categories: **Unmapped** (no rule matched —
listed for someone to assign) and **Asset sales** (excluded from sales).

## Decisions

1. **Gold / Silver / Bronze Lawn Care Packages → Lawn care only.** They are
   fertilizing / weed programs; no mowing.
2. **"Seasonal (lawn) maintenance" → Lawn mowing** (a mowing contract).
   **"Essential / Premium weekly / biweekly lawn maintenance" → Lawn mowing.**
3. **Discounts are subtracted from the service they belong to**, not put in
   Other. In order:
   1. the discount's own words name a service (e.g. "Spring Lawn Care
      Program Discount" → Lawn care);
   2. else the invoice has one service category → that one;
   3. else the invoice's largest service category (*proposed rule — confirm*);
   4. else Other, and the discount is listed.
4. **Equipment and vehicle sales are excluded from sales figures** and listed
   separately as asset sales (2026 so far: L6060 Kubota tractor + blower,
   loader arm & bucket, $20,000, invoice #7628; 2007 F-150, $1,000, #6360).
5. **Sweeping** (parking lots, roads, driveways) **is its own line**, not Snow.
6. **Freehand lines going forward — both:**
   - keyword rules (below), plus an **"Unmapped names" list in the app** that
     Dave, James or Marco can assign to a category (the assignment is
     remembered for that name);
   - **and** the common freehand services added to the Jobber catalog so new
     lines link to an item (list below).

## How a line is categorised

- A line **linked to a catalog item** is mapped by the **catalog item**, not
  the line's text (205 linked lines this year were renamed after picking, e.g.
  "Mowing (Biweekly)" → "Mowing (Weekly)").
- A **freehand** line is mapped by its name: lower-cased, punctuation removed,
  then the first matching rule below. An assigned "unmapped name" wins over the
  rules.
- Asset sales are detected first and excluded; discounts are handled per
  decision 3.

Rules, in order (first match wins):

| Category | Matches (word stems) |
|---|---|
| Sweeping | sweep |
| Snow | snow, plow/plough, sanding, salt, shovel, ice |
| Tree & stump | stump, tree, arborist, brush cut |
| Sod | sod |
| Hardscape & gravel | crusher, gravel, river rock, rock, stone, paver, patio, retaining, wall, hardscape, grading, drainage, interlock, asphalt, levelling |
| Cleanups | clean up / cleanup, leaf/leaves, brush removal |
| Hedges & shrubs | hedge, shrub, prun(ing), cedar |
| Lawn care | lawn care, turf care, fertili(zing), weed control/spray, aerat(ion), dethatch, thatch, overseed, seeding, seed, lime, grub, pest, bronze, silver, gold |
| Lawn mowing | mow, lawn maintenance, per cut, cutting, weekly, biweekly, seasonal (lawn) maintenance |
| Garden beds & landscaping | garden, bed(s), mulch, plant, landscap(ing), edging, de-weed, weeding, rototill, soil, topsoil, flower |
| Other | gutter/eavestrough, general maintenance, hours, installation, start-up, repair, disposal, fee(s), travel, hauling, additional work, follow up |

Ambiguous names are **flagged, not guessed** (see "Waiting on Marco").

## Catalog items (73) → category

| Category | Catalog items |
|---|---|
| Lawn mowing | Mowing (Biweekly) · Mowing (Weekly) · Lawn mowing - biweekly · Seasonal Lawn Maintenance |
| Lawn care | Gold / Silver / Bronze Lawn Care Package · Lawn Care · Aeration · Core Aeration · Dethatching · Dethatch, Aeration, Over-seeding · Disposal of thatch · Overseeding · Seeding · Soil + Seed (New lawn seeding) · Fertilizing · Weed Control · Weed spray · Pest Control |
| Hedges & shrubs | Hedge trimming · Hedge trimming + de-weeding · De-weeding + Shrub trimming · Pruning · Shrub Removal |
| Sod | Sod Installation · Sod Installation (Hydra bucket) · Sod Cutting & Disposal |
| Cleanups | Spring Cleanup · Spring Clean-up · Fall Cleanup · Yard Cleanup · Leaf cleanup · Leaf Removal · Garden prep/cleanup · Brush Removal · Brush and door disposal |
| Garden beds & landscaping | Flower Bed · Flower Bed De-weeding · De-weeding gardens · bed maintenance · Edging · Mulching · Fresh mulch + new edging installation · Rototill + soil application · Soil application · Soil Delivery · Soil 20 Cubic Yard · Top Soil (Delivery & Installation / Supply & Spreading) |
| Hardscape & gravel | River Rock + Delivery |
| Tree & stump | Stump Grinding · Stump grinding + sod · Stump Removal · Tree Removal & Disposal · tree trimming |
| Snow | Plowing · Snow Removal · Snow Blowing · Monthly Plow Return |
| Sweeping | Driveway Sweeping |
| Other | General Maintenance (Hourly) · Hours · Installation · Mid-Season Start-up (July 1st) · Pine hole leak - lawn repair · Gutter cleaning · Disposal fee ($100) |
| Discounts (decision 3) | [$50 OFF] Spring Lawn Care Program Discount (→ Lawn care) · Discount · Price difference |
| **Waiting on Marco** | Trimming · extra trimming in backyard |

## Waiting on Marco (flagged, not guessed)

- **"Trimming" / "extra trimming in backyard"** — hedges, or string trimming
  as part of mowing? ($2,850 this year)
- **"landscaping project"** — $32,020 on 2 lines (#7306 $30,000, Sept, no
  job). Garden beds & landscaping, or Hardscape?

## Add to the Jobber catalog

Common freehand services this year, so new lines link to an item. Where the
catalog already has the item, the fix is to **pick it** instead of typing.

Already in the catalog — pick, don't type:
- Gold / Silver / Bronze Lawn Care Package (typed 170 times, $77,900)
- Plowing (typed as "Snow plowing" 71×, $29,950)
- Dethatching (typed as "Add-on dethatching" 82×, $26,335)
- Mowing (Weekly / Biweekly) (typed as "Weekly to biweekly mowing – per cut" 140×)

New items to add:
1. Essential Biweekly Lawn Maintenance (114×, $15,392)
2. Premium Weekly Lawn Maintenance (22×, $7,190)
3. Snow Removal Contract (seasonal) ($31,700 + seasonal contracts)
4. Snow Plowing — monthly instalment (10×, $12,450)
5. Sanding Roadways (commercial sites; ~120×, $44,000+)
6. Salting Entrances & Pathways
7. Plow + Shovel (50×, $8,660)
8. Parking Lot Sweeping (and Street / Road Sweeping)
9. Crusher Fine Driveway Installation (4×, $17,120)
10. Lawn Grading & Drainage ($20,500)
11. Garden Clean-up (hourly) ($14,275)
12. Disposal of Debris (14×)
13. Rush / Travel Fee
14. Credit Card Processing Fee

Site-specific lines ("Terra Vista – Snow Plowing", "Hellenic – Sanding
Roadways") should use the generic item with the site in the description.

## Coverage, 2026 to date (decisions applied)

Issued invoices Jan 1 – Oct 20, drafts excluded: 1,917 invoices, pre-tax line
totals **$1,358,198** (asset sales of $21,000 excluded).

| Category | Pre-tax $ | Share |
|---|---|---|
| Lawn mowing | 485,312 | 35.7% |
| Snow | 221,538 | 16.3% |
| Lawn care | 155,290 | 11.4% |
| Sod | 105,845 | 7.8% |
| Garden beds & landscaping | 82,337 | 6.1% |
| Cleanups | 81,818 | 6.0% |
| Hardscape & gravel | 77,680 | 5.7% |
| Hedges & shrubs | 37,370 | 2.8% |
| Tree & stump | 26,450 | 1.9% |
| Sweeping | 17,275 | 1.3% |
| Other | 21,792 | 1.6% |
| Waiting on Marco: "landscaping project" | 32,020 | 2.4% |
| Waiting on Marco: "trimming" | 2,850 | 0.2% |
| Unmapped | 10,621 | 0.8% |

**95.0% lands in a real category**; 2.6% waits on the two answers above;
1.6% Other; 0.8% Unmapped (a long tail of one-offs, largest "lawn ripped"
$2,200). Discount lines: 62 tied by their own words, 93 by the invoice's single
service, 72 by the invoice's largest service, none left untied.
