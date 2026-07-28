export function initMenu() {
    const menuBtn = document.getElementById('menuBtn');
    const menuModal = document.getElementById('menuModal');
    const closeMenuBtn = document.getElementById('closeMenuBtn');

    if (!menuBtn || !menuModal) return;

    menuBtn.addEventListener('click', () => { menuModal.style.display = 'flex'; });
    closeMenuBtn.addEventListener('click', () => { menuModal.style.display = 'none'; });
    menuModal.addEventListener('click', (e) => {
        if (e.target === menuModal) menuModal.style.display = 'none';
    });

    document.getElementById('menuProfile')?.addEventListener('click', () => {
        alert('👤 Профиль: скоро появится!');
        menuModal.style.display = 'none';
    });
    document.getElementById('menuTheme')?.addEventListener('click', () => {
        alert('🎨 Смена темы: скоро появится!');
        menuModal.style.display = 'none';
    });
    document.getElementById('menuLogout')?.addEventListener('click', () => {
        if (confirm('Вы уверены, что хотите выйти?')) {
            window.logout?.();
            menuModal.style.display = 'none';
        }
    });
}