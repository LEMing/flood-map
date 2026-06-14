export class AddressBar {
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;

  constructor(onSubmit: (address: string) => void) {
    this.input = document.getElementById('address-input') as HTMLInputElement;
    this.button = document.getElementById('address-go') as HTMLButtonElement;

    const submit = () => onSubmit(this.input.value);
    this.button.addEventListener('click', submit);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  setValue(value: string): void {
    this.input.value = value;
  }

  setBusy(busy: boolean): void {
    this.button.disabled = busy;
    this.button.textContent = busy ? 'Loading…' : 'Load';
  }
}
