// ===== Ammama's Angadi: easy-to-edit settings =====
// Replace the WhatsApp number below with your business number.
// Use country code, without + or spaces. Example: 919876543210.
const WHATSAPP_NUMBER = "919999999999";
const WHATSAPP_MESSAGE = "Hello Ammama's Angadi! I would like to enquire about your traditional snacks.";

const whatsappBtn = document.getElementById("whatsappBtn");
if (whatsappBtn) {
  whatsappBtn.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;
}

const menuBtn = document.querySelector(".menu-btn");
const nav = document.querySelector(".nav");
if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => nav.classList.remove("open")));
}

document.getElementById("year").textContent = new Date().getFullYear();

// Replace the # below with your Instagram profile URL.
const instagramLink = document.getElementById("instagramLink");
if (instagramLink) instagramLink.href = "https://instagram.com/ammamasangadi";
