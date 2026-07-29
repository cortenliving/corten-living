// Corten Living product catalogue
const products = [
  {
    id: 'house-numbers',
    name: 'Corten House Numbers',
    category: 'numbers',
    size: '100–200 mm',
    price: 8,
    priceLabel: 'From $8',
    desc: 'Custom numbers & letters in Arial Narrow Bold. Choose height, mounting style and characters with live preview.',
    tag: 'Bestseller',
    featured: true,
    link: '/house-numbers',
    image: '/images/hn-three-holes.jpg',
    slides: [
      { src: '/images/hn-three-holes.jpg', label: '3 digit · Pre-drilled' },
      { src: '/images/hn-three-clean.jpg', label: '3 digit · Clean face' },
      { src: '/images/hn-two-holes.jpg', label: '2 digit · Pre-drilled' },
      { src: '/images/hn-two-clean.jpg', label: '2 digit · Clean face' },
      { src: '/images/hn-letters-holes.jpg', label: 'Letters · Pre-drilled' },
      { src: '/images/hn-letters-clean.jpg', label: 'Letters · Clean face' },
      { src: '/images/hn-single-holes.jpg', label: 'Single · Pre-drilled' },
      { src: '/images/hn-single-clean.jpg', label: 'Single · Clean face' }
    ]
  },
  {
    id: 'kombi-van',
    name: 'Kombi Van',
    category: 'sculpture',
    size: '500 × 600 mm',
    price: 99,
    priceLabel: '$99',
    desc: 'Classic camper van silhouette in 3 mm Corten. Stake option available for garden mounting.',
    tag: 'With stake',
    featured: true,
    link: '/quote?product=Kombi%20Van',
    image: '/images/product-kombi.jpg',
    slides: [
      { src: '/images/product-kombi.jpg', label: 'Kombi Van' },
      { src: '/images/product-kombi-2.jpg', label: 'Detail' }
    ]
  },
  {
    id: 'koru',
    name: 'Koru Garden Art',
    category: 'sculpture',
    size: 'Custom sizes',
    price: 59,
    priceLabel: 'From $59',
    desc: 'Māori koru-inspired form. Clean laser cut from 3 mm Corten for walls, fences or gardens.',
    tag: 'NZ inspired',
    featured: true,
    link: '/quote?product=Koru%20Garden%20Art',
    image: '/images/product-koru.jpg',
    slides: [
      { src: '/images/product-koru.jpg', label: 'Koru form' }
    ]
  },
  {
    id: 'hearts',
    name: 'Corten Hearts',
    category: 'sculpture',
    size: 'Various',
    price: 45,
    priceLabel: 'From $45',
    desc: 'Heart silhouettes cut from weathering steel — a simple, lasting garden statement.',
    tag: 'Gift idea',
    featured: true,
    link: '/quote?product=Corten%20Hearts',
    image: '/images/product-hearts.jpg',
    slides: [
      { src: '/images/product-hearts.jpg', label: 'Hearts' }
    ]
  },
  {
    id: 'garden-sculptures',
    name: 'Garden Sculptures',
    category: 'sculpture',
    size: 'Various',
    price: 49,
    priceLabel: 'From $49',
    desc: 'Handcrafted outdoor silhouettes — animals, icons and custom shapes. Ask about stakes and pre-weathering.',
    tag: 'Custom',
    featured: false,
    link: '/quote?product=Garden%20Sculptures',
    image: '/images/product-garden-1.jpg',
    slides: [
      { src: '/images/product-garden-1.jpg', label: 'Garden sculpture' },
      { src: '/images/product-garden-2.jpg', label: 'In the workshop' },
      { src: '/images/product-garden-3.jpg', label: 'Corten detail' },
      { src: '/images/product-garden-4.jpg', label: 'Outdoor ready' }
    ]
  },
  {
    id: 'custom-signage',
    name: 'Custom Address Plaque',
    category: 'signage',
    size: 'Up to 600 mm',
    price: 95,
    priceLabel: 'From $95',
    desc: 'Your street or property name laser-cut in 3 mm Corten. Perfect for rural RAPID and driveway entrances.',
    tag: 'Quote',
    featured: false,
    link: '/quote?product=Custom%20Address%20Plaque',
    image: '/images/hn-letters-holes.jpg',
    slides: [
      { src: '/images/hn-letters-holes.jpg', label: 'Lettering sample' },
      { src: '/images/hn-letters-clean.jpg', label: 'Clean face' }
    ]
  },
  {
    id: 'planter',
    name: 'Corten Planter Box',
    category: 'planter',
    size: 'Custom sizes',
    price: 145,
    priceLabel: 'From $145',
    desc: 'Weathering steel planter with open bottom for drainage. Built to last generations outdoors.',
    tag: 'Custom sizes',
    featured: false,
    link: '/quote?product=Corten%20Planter%20Box',
    image: '/images/hero-corten.jpg',
    slides: [
      { src: '/images/hero-corten.jpg', label: 'Corten steel' }
    ]
  }
];

// Expose for other scripts
window.products = products;
