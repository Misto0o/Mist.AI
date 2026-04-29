/* ============================================
   MistAI Documentation JavaScript
   Interactive features and animations
   ============================================ */

// Initialize AOS (Animate on Scroll)
document.addEventListener('DOMContentLoaded', function () {
    AOS.init({
        duration: 800,
        offset: 100,
        once: true,
        easing: 'ease-out'
    });

    // Initialize all interactive features
    initNavbar();
    initBackToTop();
    initFAQ();
    initCodeBlocks();
    initSmoothScroll();
    initSidebarHighlight();
});

/* ============================================
   Navbar Burger Menu
   ============================================ */
function initNavbar() {
    const burger = document.querySelector('.navbar-burger');
    const menu = document.querySelector('.navbar-menu');

    if (burger && menu) {
        burger.addEventListener('click', function () {
            burger.classList.toggle('is-active');
            menu.classList.toggle('is-active');
        });

        // Close menu when clicking on a link
        const navLinks = menu.querySelectorAll('.navbar-item');
        navLinks.forEach(link => {
            link.addEventListener('click', function () {
                burger.classList.remove('is-active');
                menu.classList.remove('is-active');
            });
        });
    }
}

/* ============================================
   Back to Top Button
   ============================================ */
function initBackToTop() {
    const backToTopButton = document.getElementById('backToTop');

    if (!backToTopButton) return;

    // Show/hide button based on scroll position
    window.addEventListener('scroll', function () {
        if (window.pageYOffset > 300) {
            backToTopButton.classList.add('visible');
        } else {
            backToTopButton.classList.remove('visible');
        }
    });

    // Scroll to top when clicked
    backToTopButton.addEventListener('click', function () {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

/* ============================================
   FAQ Accordion
   ============================================ */
function initFAQ() {
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');

        if (question) {
            question.addEventListener('click', function () {
                // Close all other FAQ items
                faqItems.forEach(otherItem => {
                    if (otherItem !== item) {
                        otherItem.classList.remove('active');
                    }
                });

                // Toggle current item
                item.classList.toggle('active');
            });
        }
    });
}

/* ============================================
   Code Block Copy Functionality
   ============================================ */
function initCodeBlocks() {
    // Highlight.js initialization
    if (typeof hljs !== 'undefined') {
        hljs.highlightAll();
    }

    // Add copy buttons to all code blocks
    const codeBlocks = document.querySelectorAll('.code-block');

    codeBlocks.forEach(block => {
        const copyBtn = block.querySelector('.copy-btn');

        if (copyBtn) {
            copyBtn.addEventListener('click', function () {
                copyCode(this);
            });
        }
    });
}

// Copy code to clipboard
function copyCode(button) {
    const codeBlock = button.closest('.code-block');
    const code = codeBlock.querySelector('code');

    if (!code) return;

    // Create temporary textarea
    const textarea = document.createElement('textarea');
    textarea.value = code.textContent;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);

    // Select and copy
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    // Visual feedback
    const originalHTML = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check"></i> Copied!';
    button.classList.add('copied');

    setTimeout(function () {
        button.innerHTML = originalHTML;
        button.classList.remove('copied');
    }, 2000);
}

/* ============================================
   Smooth Scrolling for Anchor Links
   ============================================ */
function initSmoothScroll() {
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach(link => {
        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');

            // Skip if it's just "#"
            if (href === '#') return;

            e.preventDefault();

            const target = document.querySelector(href);

            if (target) {
                const offsetTop = target.offsetTop - 100; // Account for fixed navbar

                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });

                // Update URL without jumping
                history.pushState(null, null, href);
            }
        });
    });
}

/* ============================================
   Sidebar Active Link Highlighting
   ============================================ */
function initSidebarHighlight() {
    const sections = document.querySelectorAll('.doc-section');
    const sidebarLinks = document.querySelectorAll('.sidebar-menu a');

    if (!sections.length || !sidebarLinks.length) return;

    // Highlight sidebar link based on scroll position
    window.addEventListener('scroll', function () {
        let current = '';

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;

            if (pageYOffset >= (sectionTop - 150)) {
                current = section.getAttribute('id');
            }
        });

        sidebarLinks.forEach(link => {
            link.style.backgroundColor = '';
            link.style.color = '';

            if (link.getAttribute('href') === `#${current}`) {
                link.style.backgroundColor = 'rgba(102, 126, 234, 0.2)';
                link.style.color = '#ffffff';
            }
        });
    });
}

/* ============================================
   GSAP Animations for Hero Elements
   ============================================ */
if (typeof gsap !== 'undefined') {
    // Animate AI Orb on page load
    gsap.from('.ai-orb-large', {
        scale: 0,
        opacity: 0,
        duration: 1,
        ease: 'elastic.out(1, 0.5)'
    });

    // Stagger animation for badges
    gsap.from('.badge', {
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.1,
        ease: 'power2.out',
        delay: 0.5
    });
}

/* ============================================
   Intersection Observer for Advanced Animations
   ============================================ */
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const fadeInObserver = new IntersectionObserver(function (entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('fade-in-visible');
        }
    });
}, observerOptions);

// Observe feature cards for fade-in effect
document.querySelectorAll('.feature-card, .action-card, .model-card').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';

    fadeInObserver.observe(card);
});

// Add CSS class when elements are visible
const style = document.createElement('style');
style.textContent = `
    .fade-in-visible {
        opacity: 1 !important;
        transform: translateY(0) !important;
    }
`;
document.head.appendChild(style);

/* ============================================
   Dynamic Search (Future Enhancement)
   ============================================ */
function initSearch() {
    // This can be implemented later for searching documentation
    const searchInput = document.getElementById('search-input');

    if (searchInput) {
        searchInput.addEventListener('input', function (e) {
            const searchTerm = e.target.value.toLowerCase();
            // Search functionality to be implemented
            console.log('Searching for:', searchTerm);
        });
    }
}

/* ============================================
   Keyboard Shortcuts
   ============================================ */
document.addEventListener('keydown', function (e) {
    // Ctrl/Cmd + K for search (future feature)
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        console.log('Search shortcut activated');
        // Focus search input when implemented
    }

    // Escape to close modals/menus
    if (e.key === 'Escape') {
        const burger = document.querySelector('.navbar-burger');
        const menu = document.querySelector('.navbar-menu');

        if (burger && menu && burger.classList.contains('is-active')) {
            burger.classList.remove('is-active');
            menu.classList.remove('is-active');
        }
    }
});

/* ============================================
   Print Optimization
   ============================================ */
window.addEventListener('beforeprint', function () {
    // Expand all FAQ items for printing
    document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.add('active');
    });
});

window.addEventListener('afterprint', function () {
    // Collapse FAQ items after printing
    document.querySelectorAll('.faq-item').forEach(item => {
        item.classList.remove('active');
    });
});

/* ============================================
   Mobile Detection and Adjustments
   ============================================ */
function isMobile() {
    return window.innerWidth <= 768;
}

// Adjust animations for mobile
if (isMobile()) {
    // Disable some animations on mobile for better performance
    AOS.init({
        duration: 600,
        once: true,
        disable: 'mobile'
    });
}

/* ============================================
   Easter Egg: Konami Code
   ============================================ */
let konamiCode = [];
const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

document.addEventListener('keydown', function (e) {
    konamiCode.push(e.key);
    konamiCode = konamiCode.slice(-10);

    if (konamiCode.join(',') === konamiSequence.join(',')) {
        activateEasterEgg();
    }
});

function activateEasterEgg() {
    // Fun animation when Konami code is entered
    const orbs = document.querySelectorAll('.ai-orb, .ai-orb-large');

    orbs.forEach(orb => {
        orb.style.animation = 'none';
        setTimeout(() => {
            orb.style.animation = '';

            // Rainbow effect
            if (typeof gsap !== 'undefined') {
                gsap.to(orb, {
                    background: 'linear-gradient(135deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3)',
                    duration: 2,
                    repeat: 3,
                    yoyo: true
                });
            }
        }, 10);
    });

    // Show message
    const message = document.createElement('div');
    message.textContent = '🎉 MistAI activated! You found the secret! 🎉';
    message.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        padding: 2rem 3rem;
        border-radius: 15px;
        font-size: 1.5rem;
        font-weight: bold;
        z-index: 10000;
        box-shadow: 0 10px 40px rgba(102, 126, 234, 0.5);
        animation: pulse 0.5s ease-in-out infinite alternate;
    `;

    document.body.appendChild(message);

    setTimeout(() => {
        message.remove();
    }, 3000);
}

/* ============================================
   Loading Performance Optimization
   ============================================ */
window.addEventListener('load', function () {
    // Remove any loading states
    document.body.classList.add('loaded');

    // Lazy load images if needed
    const images = document.querySelectorAll('img[data-src]');
    images.forEach(img => {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
    });
});

/* ============================================
   Console Welcome Message
   ============================================ */
console.log('%c🤖 MistAI Desktop Assistant Documentation', 'color: #667eea; font-size: 24px; font-weight: bold;');
console.log('%cBuilt with ❤️ by Kristian Cook', 'color: #764ba2; font-size: 14px;');
console.log('%cLike what you see? Check out the GitHub repo!', 'color: #10b981; font-size: 12px;');
console.log('%chttps://github.com/Misto0o/Mist.AI', 'color: #ffffff; font-size: 12px; font-weight: bold;');

/* ============================================
   Export functions for use in HTML
   ============================================ */
window.copyCode = copyCode;