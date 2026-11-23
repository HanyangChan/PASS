"""Build a reproducible untranslated product sample from Kaggle's aggregate CSV."""
import argparse
from collections import Counter, defaultdict
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re
from zipfile import ZipFile

SUBCATEGORIES = {
    'Coffee, Tea & Beverages': 'coffee_tea', 'Snack Foods': 'snack',
    'All Grocery & Gourmet Foods': 'food', 'Diet & Nutrition': 'health',
    'Make-up': 'makeup', 'Beauty & Grooming': 'beauty', 'Luxury Beauty': 'beauty',
    'Personal Care Appliances': 'personal_care', 'Health & Personal Care': 'personal_care',
    'Kitchen & Dining': 'kitchen', 'Kitchen Storage & Containers': 'kitchen',
    'Kitchen & Home Appliances': 'kitchen', 'Home Décor': 'decor',
    'Watches': 'watch', "Kids' Watches": 'watch',
    'Fashion & Silver Jewellery': 'jewelry', 'Gold & Diamond Jewellery': 'jewelry',
    'Jewellery': 'jewelry', 'Handbags & Clutches': 'bag', 'Wallets': 'bag',
    'Bags & Luggage': 'bag', 'Backpacks': 'bag', 'Sunglasses': 'accessory',
    'Headphones': 'audio', 'Speakers': 'audio', 'Home Audio & Theater': 'audio',
    'Toys & Games': 'toy', 'Toys Gifting Store': 'toy', 'International Toy Store': 'toy',
    'STEM Toys Store': 'toy', 'School Bags': 'bag',
}
MAIN_FALLBACK = {
    'tv, audio & cameras': 'digital', 'sports & fitness': 'fitness',
    'grocery & gourmet foods': 'food', 'bags & luggage': 'bag',
}
ASIN = re.compile(r'^https?://(?:www\.)?amazon\.in/(?:[^?#]*/)?dp/([A-Z0-9]{10})(?:[/?#]|$)')
NUMBER = re.compile(r'\d+(?:\.\d+)?')


def number(value):
    cleaned = value.strip().replace('₹', '').replace(',', '').strip()
    if not NUMBER.fullmatch(cleaned):
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def load(archive):
    products = {}
    counts = Counter()
    with ZipFile(archive) as dataset, dataset.open('Amazon-Products.csv') as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''))
        required = {'name', 'link', 'main_category', 'sub_category', 'ratings', 'no_of_ratings',
                    'image', 'discount_price', 'actual_price'}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError('unexpected aggregate CSV schema')
        for row in reader:
            counts['source_rows'] += 1
            name = row['name']
            match = ASIN.match(row['link'])
            price = number(row['discount_price']) or number(row['actual_price'])
            if not match or not name.strip() or not price or price <= 0:
                counts['invalid_id_name_or_price'] += 1
                continue
            asin = match[1]
            rating = number(row['ratings'])
            reviews = int(number(row['no_of_ratings']) or 0)
            main = row['main_category']
            sub = row['sub_category']
            category = SUBCATEGORIES.get(sub, MAIN_FALLBACK.get(main, 'unmapped'))
            product = {
                'asin': asin, 'name': name, 'mainCategory': main, 'subCategory': sub,
                'category': category, 'inr': float(price), 'image': row['image'] or None,
                'rating': float(rating) if rating is not None else None, 'count': reviews,
            }
            existing = products.get(asin)
            if existing:
                counts['duplicate_valid_rows'] += 1
            # Prefer a specific PASS category when the same ASIN appears in broader listings.
            priority = (sub in SUBCATEGORIES, category != 'unmapped', reviews)
            if existing is None or priority > existing[0]:
                products[asin] = (priority, product)
    counts['eligible_asins'] = len(products)
    return (product for _, product in products.values()), counts


def sample(products, target, seed):
    strata = defaultdict(list)
    for product in products:
        strata[product['mainCategory']].append(product)
    total = sum(map(len, strata.values()))
    size = min(target, total)
    quotas = {key: len(rows) * size // total for key, rows in strata.items()}
    by_remainder = sorted(strata, key=lambda key: (-(len(strata[key]) * size % total), key))
    for key in by_remainder[:size - sum(quotas.values())]:
        quotas[key] += 1

    def order(product):
        return hashlib.sha256(f"{seed}:{product['asin']}".encode()).digest()

    for key in sorted(strata):
        yield from sorted(strata[key], key=order)[:quotas[key]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--target', type=int, default=300000)
    parser.add_argument('--seed', default='pass-amazon-en-v1')
    args = parser.parse_args()
    if args.target <= 0:
        parser.error('--target must be positive')
    products, counts = load(args.zip)
    if not counts['eligible_asins']:
        raise ValueError('no eligible products')
    args.output.mkdir(parents=True, exist_ok=True)
    catalog = args.output / 'catalog.jsonl'
    raw_categories = Counter()
    app_categories = Counter()
    with catalog.open('w', encoding='utf-8') as output:
        for product in sample(products, args.target, args.seed):
            output.write(json.dumps(product, ensure_ascii=False, separators=(',', ':')) + '\n')
            raw_categories[product['mainCategory']] += 1
            app_categories[product['category']] += 1
    with args.zip.open('rb') as archive, catalog.open('rb') as data:
        manifest = {
            'source': 'https://www.kaggle.com/datasets/lokeshparab/amazon-products-dataset',
            'member': 'Amazon-Products.csv', 'source_sha256': hashlib.file_digest(archive, 'sha256').hexdigest(),
            'catalog_sha256': hashlib.file_digest(data, 'sha256').hexdigest(), 'seed': args.seed,
            'target': args.target, 'selected': sum(raw_categories.values()), **counts,
            'source_categories': dict(sorted(raw_categories.items())),
            'app_categories': dict(sorted(app_categories.items())),
        }
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
