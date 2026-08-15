// Corten Living product catalogue (seed / fallback if cloud offline)
const products = [
 {
 id: 'house-numbers',
 name: 'Corten House Numbers',
 category: 'numbers',
 size: '100–300 mm',
 price: 7,
 priceLabel: 'From $7',
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
 price: 72,
 priceLabel: 'From $54',
 desc: 'Classic 3mm Corten Steel Kombi Van Garden Sculpture\nIconic VW Kombi van design cut from 3mm Corten steel, complete with surfboard and palm trees. Supplied un weathered so it will naturally rust to a beautiful protective finish.\n\nNZ made from quality 3mm Corten steel\n\nMounting: Comes with a stake cut into the base for easy garden installation\nCustom size: Can be made to your required size\n\nUltimate Kiwi summer vibe – perfect for garden, beach house, or outdoor display.',
 tag: 'With stake',
 featured: true,
 link: '/product?id=kombi-van',
 image: '/images/product-kombi.jpg',
 slides: [
 { src: '/images/product-kombi.jpg', label: 'Kombi Van' },
 { src: '/images/product-kombi-2.jpg', label: 'Detail' }
 ],
 sizes: [
 { id: 'sm', label: 'Small', size: '375 × 450 mm', price: 54 },
 { id: 'md', label: 'Medium', size: '500 × 600 mm', price: 72 },
 { id: 'lg', label: 'Large', size: '625 × 750 mm', price: 98 }
 ]
 },
 {
 id: 'koru',
 name: 'Koru Garden Art',
 category: 'sculpture',
 size: 'Custom sizes',
 price: 59,
 priceLabel: 'From $44',
 desc: 'Māori koru-inspired form. Clean profile cut from 3 mm Corten for walls, fences or gardens.',
 tag: 'NZ inspired',
 featured: true,
 link: '/product?id=koru',
 image: '/images/product-koru.jpg',
 slides: [
 { src: '/images/product-koru.jpg', label: 'Koru form' }
 ],
 sizes: [
 { id: 'sm', label: 'Small', size: '300 mm', price: 44 },
 { id: 'md', label: 'Medium', size: '450 mm', price: 59 },
 { id: 'lg', label: 'Large', size: '600 mm', price: 79 }
 ]
 },
 {
 id: 'hearts',
 name: 'Corten Hearts',
 category: 'sculpture',
 size: 'Various',
 price: 45,
 priceLabel: 'From $34',
 desc: 'Heart silhouettes cut from weathering steel — a simple, lasting garden statement.',
 tag: 'Gift idea',
 featured: true,
 link: '/product?id=hearts',
 image: '/images/product-hearts.jpg',
 slides: [
 { src: '/images/product-hearts.jpg', label: 'Hearts' }
 ],
 sizes: [
 { id: 'sm', label: 'Small', size: '200 mm', price: 34 },
 { id: 'md', label: 'Medium', size: '300 mm', price: 45 },
 { id: 'lg', label: 'Large', size: '400 mm', price: 62 }
 ]
 },
 {
 id: 'garden-sculptures',
 name: 'Garden Sculptures',
 category: 'sculpture',
 size: 'Various',
 price: 49,
 priceLabel: 'From $37',
 desc: 'Profile-cut outdoor silhouettes — animals, icons and custom shapes. Ask about stakes. Supplied raw to weather naturally.',
 tag: 'Custom',
 featured: false,
 link: '/product?id=garden-sculptures',
 image: '/images/product-garden-1.jpg',
 slides: [
 { src: '/images/product-garden-1.jpg', label: 'Garden sculpture' },
 { src: '/images/product-garden-2.jpg', label: 'In the workshop' },
 { src: '/images/product-garden-3.jpg', label: 'Corten detail' },
 { src: '/images/product-garden-4.jpg', label: 'Outdoor ready' }
 ],
 sizes: [
 { id: 'sm', label: 'Small', size: '300 mm', price: 37 },
 { id: 'md', label: 'Medium', size: '450 mm', price: 49 },
 { id: 'lg', label: 'Large', size: '600 mm', price: 69 }
 ]
 },
 {
 id: 'custom-signage',
 name: 'Custom Address Plaque',
 category: 'signage',
 size: 'Up to 600 mm',
 price: 95,
 priceLabel: 'From $75',
 desc: 'Your street or property name profile-cut in 3 mm Corten. Perfect for driveway entrances.',
 tag: 'Quote',
 featured: false,
 link: '/product?id=custom-signage',
 image: '/images/hn-letters-holes.jpg',
 slides: [
 { src: '/images/hn-letters-holes.jpg', label: 'Lettering sample' },
 { src: '/images/hn-letters-clean.jpg', label: 'Clean face' }
 ],
 sizes: [
 { id: 'sm', label: 'Small', size: 'Up to 300 mm', price: 75 },
 { id: 'md', label: 'Medium', size: 'Up to 450 mm', price: 95 },
 { id: 'lg', label: 'Large', size: 'Up to 600 mm', price: 125 }
 ]
 },
 {
 id: 'planter',
 name: 'Corten Planter Box',
 category: 'planter',
 size: 'Custom sizes',
 price: 145,
 priceLabel: 'From $115',
 desc: 'Weathering steel planter with open bottom for drainage. Built to last generations outdoors.',
 tag: 'Custom sizes',
 featured: false,
 link: '/product?id=planter',
 image: '/images/hero-corten.jpg',
 slides: [
 { src: '/images/hero-corten.jpg', label: 'Corten steel' }
 ],
 sizes: [
 { id: 'sm', label: 'Small', size: '400 mm wide', price: 115 },
 { id: 'md', label: 'Medium', size: '600 mm wide', price: 145 },
 { id: 'lg', label: 'Large', size: '800 mm wide', price: 185 }
 ]
 }
];

// Expose for other scripts
window.products = products;
