import { Pipe, PipeTransform } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { PrivacyModeService } from '../../core/services/privacy-mode.service';

@Pipe({
    name: 'maskCurrency',
    standalone: true,
    pure: false
})
export class MaskCurrencyPipe implements PipeTransform {
    private readonly currencyPipe = new CurrencyPipe('en-IN');

    constructor(private readonly privacyModeService: PrivacyModeService) {}

    transform(
        value: number | null | undefined,
        currencyCode: string = 'INR',
        display: string | boolean = 'symbol',
        digitsInfo?: string,
        locale?: string
    ): string {
        if (this.privacyModeService.hideAmounts()) {
            return '••••';
        }
        if (value === null || value === undefined) {
            return '';
        }
        return this.currencyPipe.transform(value, currencyCode, display, digitsInfo, locale) ?? '';
    }
}
